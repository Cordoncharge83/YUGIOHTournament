from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Tournament(Base):
    __tablename__ = "tournaments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str | None] = mapped_column(String(255))
    current_round_id: Mapped[int | None] = mapped_column(ForeignKey("rounds.id"))
    kts_file_path: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    players: Mapped[list[Player]] = relationship(back_populates="tournament")
    rounds: Mapped[list[Round]] = relationship(back_populates="tournament", foreign_keys="Round.tournament_id")
    current_round: Mapped[Round | None] = relationship(foreign_keys=[current_round_id])
    matches: Mapped[list[Match]] = relationship(back_populates="tournament")
    standings: Mapped[list[Standing]] = relationship(back_populates="tournament")


class PlayerProfile(Base):
    __tablename__ = "player_profiles"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    cossy_id: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    tournament_players: Mapped[list[Player]] = relationship(back_populates="player_profile")
    standings: Mapped[list[Standing]] = relationship(back_populates="player_profile")


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    player_profile_id: Mapped[int | None] = mapped_column(ForeignKey("player_profiles.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    tournament: Mapped[Tournament] = relationship(back_populates="players")
    player_profile: Mapped[PlayerProfile | None] = relationship(back_populates="tournament_players")
    matches_as_player_one: Mapped[list[Match]] = relationship(
        back_populates="player_one",
        foreign_keys="Match.player_one_id",
    )
    matches_as_player_two: Mapped[list[Match]] = relationship(
        back_populates="player_two",
        foreign_keys="Match.player_two_id",
    )

    @property
    def cossy_id(self) -> str | None:
        return self.player_profile.cossy_id if self.player_profile else None


class Round(Base):
    __tablename__ = "rounds"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)

    tournament: Mapped[Tournament] = relationship(back_populates="rounds", foreign_keys=[tournament_id])
    matches: Mapped[list[Match]] = relationship(back_populates="round")


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    round_id: Mapped[int] = mapped_column(ForeignKey("rounds.id"), nullable=False)
    table_number: Mapped[int | None] = mapped_column(Integer)
    player_one_id: Mapped[int] = mapped_column(ForeignKey("players.id"), nullable=False)
    player_two_id: Mapped[int | None] = mapped_column(ForeignKey("players.id"))
    player_one_score: Mapped[int | None] = mapped_column(Integer)
    player_two_score: Mapped[int | None] = mapped_column(Integer)
    result_status: Mapped[str] = mapped_column(String(32), nullable=False, default="UNREPORTED", server_default="UNREPORTED")
    notes: Mapped[str | None] = mapped_column(Text)

    tournament: Mapped[Tournament] = relationship(back_populates="matches")
    round: Mapped[Round] = relationship(back_populates="matches")
    player_one: Mapped[Player] = relationship(
        back_populates="matches_as_player_one",
        foreign_keys=[player_one_id],
    )
    player_two: Mapped[Player | None] = relationship(
        back_populates="matches_as_player_two",
        foreign_keys=[player_two_id],
    )


class Standing(Base):
    __tablename__ = "standings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    player_profile_id: Mapped[int | None] = mapped_column(ForeignKey("player_profiles.id"), index=True)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(255))
    cossy_id: Mapped[str | None] = mapped_column(String(64))
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    tiebreaker: Mapped[str | None] = mapped_column(String(64))

    tournament: Mapped[Tournament] = relationship(back_populates="standings")
    player_profile: Mapped[PlayerProfile | None] = relationship(back_populates="standings")
