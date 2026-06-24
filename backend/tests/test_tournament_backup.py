import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Match, Player, PlayerProfile, PlayoffBracket, PlayoffMatch, Round, Standing, Tournament
from app.routes.tournaments import build_tournament_backup, import_tournament_backup_payload


class TournamentBackupTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def create_source_tournament(self, db):
        tournament = Tournament(
            name="TCS",
            location="Local Store",
            counts_toward_community_stats=False,
            publish_status="published",
            public_id="live-tcs",
            public_url="https://example.test/t/live-tcs",
            kts_file_path="C:/secret/local/file.Tournament",
        )
        db.add(tournament)
        db.flush()

        profiles = []
        players = []
        for index, name in enumerate(["Yugi", "Kaiba"], start=1):
            profile = PlayerProfile(display_name=name, normalized_name=name.casefold(), cossy_id=f"cossy-{index}")
            db.add(profile)
            db.flush()
            profiles.append(profile)
            player = Player(tournament_id=tournament.id, player_profile_id=profile.id, name=name)
            db.add(player)
            db.flush()
            players.append(player)
            db.add(
                Standing(
                    tournament_id=tournament.id,
                    player_profile_id=profile.id,
                    rank=index,
                    full_name=name,
                    short_name=name,
                    cossy_id=profile.cossy_id,
                    points=3 - index,
                    tiebreaker=str(90 - index),
                )
            )

        round_ = Round(tournament_id=tournament.id, number=1)
        db.add(round_)
        db.flush()
        tournament.current_round_id = round_.id
        match = Match(
            tournament_id=tournament.id,
            round_id=round_.id,
            table_number=7,
            player_one_id=players[0].id,
            player_two_id=players[1].id,
            result_status="PLAYER_ONE_WIN",
            notes=None,
        )
        db.add(match)

        bracket = PlayoffBracket(tournament_id=tournament.id, size=4, status="active")
        db.add(bracket)
        db.flush()
        db.add(
            PlayoffMatch(
                bracket_id=bracket.id,
                round_index=0,
                match_index=0,
                player_one_profile_id=profiles[0].id,
                player_two_profile_id=profiles[1].id,
                winner_profile_id=profiles[0].id,
                player_one_name="Yugi",
                player_two_name="Kaiba",
                player_one_seed=1,
                player_two_seed=4,
            )
        )
        db.add(PlayoffMatch(bracket_id=bracket.id, round_index=1, match_index=0, player_one_name="Yugi", player_one_seed=1))

        db.commit()
        db.refresh(tournament)
        return tournament, players, round_, match, bracket

    def test_export_import_round_trip_recreates_visible_data_with_new_ids(self):
        db = self.SessionLocal()
        try:
            source_tournament, source_players, source_round, source_match, source_bracket = self.create_source_tournament(db)
            backup = build_tournament_backup(db, source_tournament)

            self.assertEqual(backup["backup_version"], 1)
            self.assertEqual(backup["app"], "Yu-Gi-Oh Tournament Manager")
            self.assertNotIn("publish_key", str(backup).casefold())
            self.assertNotIn("kts_file_path", str(backup).casefold())
            self.assertNotIn("C:/secret/local/file.Tournament", str(backup))

            imported = import_tournament_backup_payload(db, backup)
            self.assertNotEqual(imported.id, source_tournament.id)
            self.assertEqual(imported.name, "TCS (Imported)")
            self.assertEqual(imported.location, "Local Store")
            self.assertFalse(imported.counts_toward_community_stats)
            self.assertEqual(imported.publish_status, "draft")
            self.assertIsNone(imported.public_id)
            self.assertIsNone(imported.public_url)
            self.assertIsNone(imported.kts_file_path)

            imported_players = list(db.scalars(select(Player).where(Player.tournament_id == imported.id).order_by(Player.name)))
            imported_round = db.scalar(select(Round).where(Round.tournament_id == imported.id))
            imported_match = db.scalar(select(Match).where(Match.tournament_id == imported.id))
            imported_standings = list(db.scalars(select(Standing).where(Standing.tournament_id == imported.id).order_by(Standing.rank)))
            imported_bracket = db.scalar(select(PlayoffBracket).where(PlayoffBracket.tournament_id == imported.id))
            imported_playoff_matches = list(db.scalars(select(PlayoffMatch).where(PlayoffMatch.bracket_id == imported_bracket.id).order_by(PlayoffMatch.round_index, PlayoffMatch.match_index)))

            self.assertEqual([player.name for player in imported_players], ["Kaiba", "Yugi"])
            self.assertNotIn(source_players[0].id, {player.id for player in imported_players})
            self.assertEqual(imported_round.number, 1)
            self.assertNotEqual(imported_round.id, source_round.id)
            self.assertEqual(imported.current_round_id, imported_round.id)
            self.assertEqual(imported_match.table_number, 7)
            self.assertEqual(imported_match.result_status, "PLAYER_ONE_WIN")
            self.assertNotEqual(imported_match.id, source_match.id)
            self.assertEqual([standing.full_name for standing in imported_standings], ["Yugi", "Kaiba"])
            self.assertEqual(imported_bracket.size, source_bracket.size)
            self.assertEqual(imported_playoff_matches[0].player_one_name, "Yugi")
            self.assertEqual(imported_playoff_matches[0].winner_profile_id, imported_playoff_matches[0].player_one_profile_id)
        finally:
            db.close()

    def test_import_duplicate_name_gets_numbered_suffix(self):
        db = self.SessionLocal()
        try:
            source_tournament, *_ = self.create_source_tournament(db)
            backup = build_tournament_backup(db, source_tournament)

            first_import = import_tournament_backup_payload(db, backup)
            second_import = import_tournament_backup_payload(db, backup)

            self.assertEqual(first_import.name, "TCS (Imported)")
            self.assertEqual(second_import.name, "TCS (Imported 2)")
        finally:
            db.close()

    def test_import_rejects_invalid_backup_marker(self):
        db = self.SessionLocal()
        try:
            with self.assertRaises(HTTPException):
                import_tournament_backup_payload(db, {"backup_version": 999, "app": "Other App"})
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
