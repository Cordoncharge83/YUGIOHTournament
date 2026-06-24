import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import PlayerProfile, Standing, Tournament
from app.publishing import build_publish_payload
from app.public_publishing_client import PublicPublishingRemoteError
from app.routes.tournaments import (
    create_playoffs,
    delete_playoffs,
    get_tournament_playoff_bracket,
    import_parsed_tournament_file,
    update_playoff_winner,
)
from app.schemas import PlayoffCreate, PlayoffWinnerUpdate


class PlayoffTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def seed_tournament(self, db, player_count=16):
        tournament = Tournament(name="Top Cut Test")
        db.add(tournament)
        db.flush()

        profiles = []
        for rank in range(1, player_count + 1):
            profile = PlayerProfile(
                display_name=f"Player {rank}",
                normalized_name=f"player {rank}",
                cossy_id=str(rank),
            )
            db.add(profile)
            db.flush()
            profiles.append(profile)
            db.add(
                Standing(
                    tournament_id=tournament.id,
                    player_profile_id=profile.id,
                    rank=rank,
                    full_name=profile.display_name,
                    short_name=profile.display_name,
                    points=player_count - rank,
                )
            )

        db.commit()
        return tournament, profiles

    def seed_pairs(self, bracket):
        first_round = [match for match in bracket.matches if match.round_index == 0]
        return [(match.player_one_seed, match.player_two_seed) for match in first_round]

    def test_creates_top_4_with_protected_seed_order(self):
        db = self.SessionLocal()
        try:
            tournament, _profiles = self.seed_tournament(db, 4)
            bracket = create_playoffs(tournament.id, PlayoffCreate(size=4), db)
            self.assertEqual(self.seed_pairs(bracket), [(1, 4), (2, 3)])
        finally:
            db.close()

    def test_creates_top_8_with_protected_seed_order(self):
        db = self.SessionLocal()
        try:
            tournament, _profiles = self.seed_tournament(db, 8)
            bracket = create_playoffs(tournament.id, PlayoffCreate(size=8), db)
            self.assertEqual(self.seed_pairs(bracket), [(1, 8), (4, 5), (3, 6), (2, 7)])
        finally:
            db.close()

    def test_creates_top_16_with_exact_protected_seed_order(self):
        db = self.SessionLocal()
        try:
            tournament, _profiles = self.seed_tournament(db, 16)
            bracket = create_playoffs(tournament.id, PlayoffCreate(size=16), db)
            self.assertEqual(
                self.seed_pairs(bracket),
                [(1, 16), (8, 9), (5, 12), (4, 13), (3, 14), (6, 11), (7, 10), (2, 15)],
            )
        finally:
            db.close()

    def test_winner_advances_and_changed_prior_winner_clears_stale_downstream_result(self):
        db = self.SessionLocal()
        try:
            tournament, profiles = self.seed_tournament(db, 4)
            bracket = create_playoffs(tournament.id, PlayoffCreate(size=4), db)
            semifinals = [match for match in bracket.matches if match.round_index == 0]
            final = [match for match in bracket.matches if match.round_index == 1][0]

            bracket = update_playoff_winner(
                tournament.id,
                semifinals[0].id,
                PlayoffWinnerUpdate(winner_player_id=profiles[0].id),
                db,
            )
            final = [match for match in bracket.matches if match.round_index == 1][0]
            self.assertEqual(final.player_one_id, profiles[0].id)

            bracket = update_playoff_winner(
                tournament.id,
                semifinals[1].id,
                PlayoffWinnerUpdate(winner_player_id=profiles[1].id),
                db,
            )
            final = [match for match in bracket.matches if match.round_index == 1][0]
            bracket = update_playoff_winner(
                tournament.id,
                final.id,
                PlayoffWinnerUpdate(winner_player_id=profiles[0].id),
                db,
            )
            self.assertEqual(bracket.status, "completed")

            bracket = update_playoff_winner(
                tournament.id,
                semifinals[0].id,
                PlayoffWinnerUpdate(winner_player_id=profiles[3].id),
                db,
            )
            final = [match for match in bracket.matches if match.round_index == 1][0]
            self.assertEqual(final.player_one_id, profiles[3].id)
            self.assertIsNone(final.winner_player_id)
            self.assertEqual(bracket.status, "active")
        finally:
            db.close()

    def test_changed_quarterfinal_winner_clears_reachable_downstream_even_if_winner_still_present(self):
        db = self.SessionLocal()
        try:
            tournament, profiles = self.seed_tournament(db, 8)
            bracket = create_playoffs(tournament.id, PlayoffCreate(size=8), db)
            quarterfinals = [match for match in bracket.matches if match.round_index == 0]

            for match in quarterfinals:
                bracket = update_playoff_winner(
                    tournament.id,
                    match.id,
                    PlayoffWinnerUpdate(winner_player_id=match.player_one_id),
                    db,
                )

            semifinals = [match for match in bracket.matches if match.round_index == 1]
            bracket = update_playoff_winner(
                tournament.id,
                semifinals[0].id,
                PlayoffWinnerUpdate(winner_player_id=semifinals[0].player_two_id),
                db,
            )
            bracket = update_playoff_winner(
                tournament.id,
                semifinals[1].id,
                PlayoffWinnerUpdate(winner_player_id=semifinals[1].player_one_id),
                db,
            )
            final = [match for match in bracket.matches if match.round_index == 2][0]
            bracket = update_playoff_winner(
                tournament.id,
                final.id,
                PlayoffWinnerUpdate(winner_player_id=final.player_one_id),
                db,
            )
            self.assertEqual(bracket.status, "completed")

            bracket = update_playoff_winner(
                tournament.id,
                quarterfinals[0].id,
                PlayoffWinnerUpdate(winner_player_id=profiles[7].id),
                db,
            )

            semifinals = [match for match in bracket.matches if match.round_index == 1]
            final = [match for match in bracket.matches if match.round_index == 2][0]
            self.assertEqual(semifinals[0].player_one_id, profiles[7].id)
            self.assertIsNone(semifinals[0].winner_player_id)
            self.assertEqual(semifinals[1].winner_player_id, semifinals[1].player_one_id)
            self.assertIsNone(final.winner_player_id)
            self.assertEqual(bracket.status, "active")
        finally:
            db.close()

    def test_requires_enough_standings_players(self):
        db = self.SessionLocal()
        try:
            tournament, _profiles = self.seed_tournament(db, 3)
            with self.assertRaises(HTTPException):
                create_playoffs(tournament.id, PlayoffCreate(size=4), db)
        finally:
            db.close()

    def test_delete_playoffs_leaves_tournament_standings(self):
        db = self.SessionLocal()
        try:
            tournament, _profiles = self.seed_tournament(db, 4)
            create_playoffs(tournament.id, PlayoffCreate(size=4), db)
            delete_playoffs(tournament.id, db)
            standings_count = db.query(Standing).filter(Standing.tournament_id == tournament.id).count()
            self.assertEqual(standings_count, 4)
        finally:
            db.close()

    def test_full_tournament_import_does_not_delete_playoffs(self):
        db = self.SessionLocal()
        try:
            tournament, _profiles = self.seed_tournament(db, 4)
            bracket = create_playoffs(tournament.id, PlayoffCreate(size=4), db)

            import_parsed_tournament_file(
                db,
                tournament.id,
                {
                    "current_round": None,
                    "players": [{"name": f"Imported {index}", "cossy_id": f"new-{index}"} for index in range(1, 5)],
                    "matches": [],
                    "round_numbers": [],
                    "standings": [
                        {
                            "rank": index,
                            "full_name": f"Imported {index}",
                            "short_name": f"Imported {index}",
                            "cossy_id": f"new-{index}",
                            "points": 4 - index,
                            "tiebreaker": None,
                        }
                        for index in range(1, 5)
                    ],
                },
            )

            preserved_bracket = get_tournament_playoff_bracket(db, tournament.id)
            self.assertIsNotNone(preserved_bracket)
            self.assertEqual(preserved_bracket.id, bracket.id)
        finally:
            db.close()

    def test_publish_payload_includes_public_safe_playoff_bracket(self):
        db = self.SessionLocal()
        try:
            tournament, profiles = self.seed_tournament(db, 8)
            bracket = create_playoffs(tournament.id, PlayoffCreate(size=8), db)
            quarterfinals = [match for match in bracket.matches if match.round_index == 0]
            bracket = update_playoff_winner(
                tournament.id,
                quarterfinals[0].id,
                PlayoffWinnerUpdate(winner_player_id=profiles[0].id),
                db,
            )

            payload = build_publish_payload(db, tournament)
            playoff_bracket = payload["playoff_bracket"]

            self.assertEqual(playoff_bracket["size"], 8)
            self.assertEqual(playoff_bracket["rounds"][0]["name"], "Quarterfinals")
            self.assertEqual(playoff_bracket["rounds"][0]["matches"][0]["players"][0]["seed"], 1)
            self.assertEqual(playoff_bracket["rounds"][0]["matches"][0]["players"][0]["name"], "Player 1")
            self.assertTrue(playoff_bracket["rounds"][0]["matches"][0]["players"][0]["winner"])

            def assert_public_safe(value):
                if isinstance(value, dict):
                    for key, nested_value in value.items():
                        self.assertNotIn("cossy", key)
                        self.assertNotEqual(key, "id")
                        self.assertFalse(key.endswith("_id"), key)
                        self.assertNotIn("file_path", key)
                        assert_public_safe(nested_value)
                elif isinstance(value, list):
                    for item in value:
                        assert_public_safe(item)

            assert_public_safe(playoff_bracket)
        finally:
            db.close()

    def test_published_tournament_playoff_changes_refresh_public_snapshot(self):
        db = self.SessionLocal()
        try:
            tournament, profiles = self.seed_tournament(db, 8)
            tournament.publish_status = "published"
            tournament.public_id = "top-cut-test"
            db.commit()

            with (
                patch("app.routes.tournaments.publish_snapshot") as publish_snapshot_mock,
                patch("app.routes.tournaments.publish_tournament") as publish_tournament_mock,
            ):
                bracket = create_playoffs(tournament.id, PlayoffCreate(size=8), db)
                publish_snapshot_mock.assert_called_once()
                self.assertEqual(publish_snapshot_mock.call_args.args[0], "top-cut-test")
                self.assertIn("playoff_bracket", publish_snapshot_mock.call_args.args[1])
                publish_tournament_mock.assert_called_once()

            quarterfinal = [match for match in bracket.matches if match.round_index == 0][0]
            with (
                patch("app.routes.tournaments.publish_snapshot") as publish_snapshot_mock,
                patch("app.routes.tournaments.publish_tournament") as publish_tournament_mock,
            ):
                update_playoff_winner(
                    tournament.id,
                    quarterfinal.id,
                    PlayoffWinnerUpdate(winner_player_id=profiles[0].id),
                    db,
                )
                publish_snapshot_mock.assert_called_once()
                self.assertTrue(
                    publish_snapshot_mock.call_args.args[1]["playoff_bracket"]["rounds"][0]["matches"][0]["players"][0]["winner"]
                )
                publish_tournament_mock.assert_called_once()

            with (
                patch("app.routes.tournaments.publish_snapshot") as publish_snapshot_mock,
                patch("app.routes.tournaments.publish_tournament") as publish_tournament_mock,
            ):
                delete_playoffs(tournament.id, db)
                publish_snapshot_mock.assert_called_once()
                self.assertIsNone(publish_snapshot_mock.call_args.args[1]["playoff_bracket"])
                publish_tournament_mock.assert_called_once()
        finally:
            db.close()

    def test_playoff_auto_publish_failure_does_not_undo_local_change(self):
        db = self.SessionLocal()
        try:
            tournament, _profiles = self.seed_tournament(db, 4)
            tournament.publish_status = "published"
            tournament.public_id = "top-cut-test"
            db.commit()

            with patch(
                "app.routes.tournaments.publish_snapshot",
                side_effect=PublicPublishingRemoteError("Worker unavailable"),
            ):
                bracket = create_playoffs(tournament.id, PlayoffCreate(size=4), db)

            preserved_bracket = get_tournament_playoff_bracket(db, tournament.id)
            self.assertIsNotNone(preserved_bracket)
            self.assertEqual(preserved_bracket.id, bracket.id)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
