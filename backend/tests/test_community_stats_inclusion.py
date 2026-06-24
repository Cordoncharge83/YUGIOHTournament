import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Player, PlayerProfile, Standing, Tournament
from app.routes.player_profiles import build_profile_summary, get_player_profile
from app.routes.tournaments import update_community_stats_inclusion
from app.schemas import TournamentCommunityStatsUpdate


class CommunityStatsInclusionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def test_excluded_tournament_does_not_count_toward_profile_stats_until_reenabled(self):
        db = self.SessionLocal()
        try:
            profile = PlayerProfile(
                display_name="Yugi Muto",
                normalized_name="yugi muto",
                cossy_id="123",
            )
            counted_tournament = Tournament(name="Counted Regional")
            excluded_tournament = Tournament(name="Test Event", counts_toward_community_stats=False)
            db.add_all([profile, counted_tournament, excluded_tournament])
            db.flush()

            counted_player = Player(
                tournament_id=counted_tournament.id,
                player_profile_id=profile.id,
                name=profile.display_name,
            )
            excluded_player = Player(
                tournament_id=excluded_tournament.id,
                player_profile_id=profile.id,
                name=profile.display_name,
            )
            db.add_all([counted_player, excluded_player])
            db.add_all(
                [
                    Standing(
                        tournament_id=counted_tournament.id,
                        player_profile_id=profile.id,
                        rank=2,
                        full_name=profile.display_name,
                        points=9,
                    ),
                    Standing(
                        tournament_id=excluded_tournament.id,
                        player_profile_id=profile.id,
                        rank=1,
                        full_name=profile.display_name,
                        points=30,
                    ),
                ]
            )
            db.commit()

            summary = build_profile_summary(db, profile)
            self.assertEqual(summary.tournaments_played, 1)
            self.assertEqual(summary.total_points, 9)
            self.assertEqual(summary.best_rank, 2)

            detail = get_player_profile(profile.id, db)
            self.assertEqual(len(detail.tournament_history), 1)
            self.assertEqual(detail.tournament_history[0].tournament_name, counted_tournament.name)

            update_community_stats_inclusion(
                excluded_tournament.id,
                TournamentCommunityStatsUpdate(counts_toward_community_stats=True),
                db,
            )

            updated_summary = build_profile_summary(db, profile)
            self.assertEqual(updated_summary.tournaments_played, 2)
            self.assertEqual(updated_summary.total_points, 39)
            self.assertEqual(updated_summary.best_rank, 1)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
