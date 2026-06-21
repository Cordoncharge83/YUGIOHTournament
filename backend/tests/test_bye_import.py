import unittest

from defusedxml.ElementTree import fromstring
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Match, Tournament
from app.public_snapshots import build_public_tournament_snapshot
from app.routes.public import get_public_tournament
from app.routes.tournaments import import_parsed_tournament_file, parse_tournament_file


KTS_TOURNAMENT_WITH_LITERAL_BYE = """\
<Tournament>
  <CurrentRound>1</CurrentRound>
  <TournamentPlayers>
    <TournPlayer>
      <Player>
        <ID>111</ID>
        <FirstName>Seto</FirstName>
        <LastName>Kaiba</LastName>
      </Player>
      <Rank>1</Rank>
      <Points>3</Points>
      <Wins>1</Wins>
    </TournPlayer>
  </TournamentPlayers>
  <Matches>
    <TournMatch>
      <Round>1</Round>
      <Table>7</Table>
      <Player><ID>111</ID></Player>
      <Player><ID>BYE</ID></Player>
      <Status>Unreported</Status>
    </TournMatch>
  </Matches>
</Tournament>
"""

KTS_TOURNAMENT_WITH_ZERO_ID_BYE = KTS_TOURNAMENT_WITH_LITERAL_BYE.replace("<Player><ID>BYE</ID></Player>", "<Player><ID>0</ID></Player>")


class ByeImportTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=engine)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def test_literal_bye_imports_as_auto_win_and_public_pairing(self):
        root = fromstring(KTS_TOURNAMENT_WITH_LITERAL_BYE)
        parsed_file = parse_tournament_file(root)

        self.assertEqual(
            parsed_file["matches"],
            [
                {
                    "round_number": 1,
                    "table_number": 7,
                    "player_one_cossy_id": "111",
                    "player_two_cossy_id": None,
                    "result_status": "PLAYER_ONE_WIN",
                    "notes": "BYE",
                }
            ],
        )

        db = self.SessionLocal()
        try:
            tournament = Tournament(name="Regional Qualifier")
            db.add(tournament)
            db.commit()
            db.refresh(tournament)

            summary = import_parsed_tournament_file(db, tournament.id, parsed_file)
            self.assertEqual(summary.players_imported, 1)
            self.assertEqual(summary.rounds_imported, 1)
            self.assertEqual(summary.matches_imported, 1)
            self.assertEqual(summary.standings_imported, 1)
            self.assertEqual(summary.current_round, 1)

            match = db.scalar(select(Match).where(Match.tournament_id == tournament.id))
            self.assertIsNotNone(match)
            self.assertEqual(match.table_number, 7)
            self.assertIsNone(match.player_two_id)
            self.assertEqual(match.result_status, "PLAYER_ONE_WIN")
            self.assertEqual(match.notes, "BYE")

            public_tournament = get_public_tournament(tournament.id, db)
            self.assertEqual(len(public_tournament.matches), 1)
            self.assertEqual(public_tournament.matches[0].player_one_name, "Kaiba, Seto")
            self.assertEqual(public_tournament.matches[0].player_two_name, "BYE")
            self.assertEqual(public_tournament.matches[0].result_status, "PLAYER_ONE_WIN")
            self.assertEqual(public_tournament.standings[0].points, 1)

            snapshot = build_public_tournament_snapshot(db, tournament)
            self.assertEqual(len(snapshot.current_round_pairings), 1)
            self.assertEqual(snapshot.current_round_pairings[0].table_number, 7)
            self.assertEqual(snapshot.current_round_pairings[0].player_two_name, "BYE")
            self.assertEqual(snapshot.current_round_pairings[0].notes, "BYE")
            snapshot_payload = snapshot.model_dump(mode="json")
            self.assertNotIn("cossy_id", str(snapshot_payload))
            self.assertNotIn("player_id", str(snapshot_payload))
            self.assertNotIn("match_id", str(snapshot_payload))
        finally:
            db.close()

    def test_zero_id_bye_imports_as_auto_win_and_repairs_stale_import(self):
        root = fromstring(KTS_TOURNAMENT_WITH_ZERO_ID_BYE)
        parsed_file = parse_tournament_file(root)

        self.assertEqual(parsed_file["matches"][0]["player_two_cossy_id"], None)
        self.assertEqual(parsed_file["matches"][0]["result_status"], "PLAYER_ONE_WIN")
        self.assertEqual(parsed_file["matches"][0]["notes"], "BYE")

        db = self.SessionLocal()
        try:
            tournament = Tournament(name="Regional Qualifier")
            db.add(tournament)
            db.commit()
            db.refresh(tournament)

            stale_file = {
                **parsed_file,
                "matches": [],
            }
            stale_summary = import_parsed_tournament_file(db, tournament.id, stale_file)
            self.assertEqual(stale_summary.matches_imported, 0)

            repaired_summary = import_parsed_tournament_file(db, tournament.id, parsed_file)
            self.assertEqual(repaired_summary.matches_imported, 1)

            match = db.scalar(select(Match).where(Match.tournament_id == tournament.id))
            self.assertIsNotNone(match)
            self.assertEqual(match.table_number, 7)
            self.assertIsNone(match.player_two_id)
            self.assertEqual(match.result_status, "PLAYER_ONE_WIN")
            self.assertEqual(match.notes, "BYE")

            snapshot = build_public_tournament_snapshot(db, tournament)
            self.assertEqual(len(snapshot.current_round_pairings), 1)
            self.assertEqual(snapshot.current_round_pairings[0].player_one_name, "Kaiba, Seto")
            self.assertEqual(snapshot.current_round_pairings[0].player_two_name, "BYE")
            self.assertEqual(snapshot.current_round_pairings[0].result_status, "PLAYER_ONE_WIN")
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
