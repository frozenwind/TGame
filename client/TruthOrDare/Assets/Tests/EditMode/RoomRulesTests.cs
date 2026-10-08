using Game.HotUpdate;
using NUnit.Framework;

namespace Game.Tests
{
    public sealed class RoomRulesTests
    {
        [Test]
        public void AcceptsFirstSnapshotAndNextRevision()
        {
            var first = Room(1, "AAAAAA");
            var initial = RoomReducer.Apply(null, first, true);
            Assert.AreEqual(ReduceStatus.Accepted, initial.Status);

            var next = Room(2, "AAAAAA");
            var updated = RoomReducer.Apply(initial.Room, next, false);
            Assert.AreEqual(ReduceStatus.Accepted, updated.Status);
            Assert.AreEqual(2, updated.Room.revision);
        }

        [Test]
        public void IgnoresDuplicatesAndRequestsSyncOnGap()
        {
            var current = Room(3, "AAAAAA");
            var duplicate = RoomReducer.Apply(current, Room(3, "BBBBBB"), false);
            Assert.AreEqual(ReduceStatus.Ignored, duplicate.Status);
            Assert.AreEqual("AAAAAA", duplicate.Room.code);

            var older = RoomReducer.Apply(current, Room(2, "CCCCCC"), true);
            Assert.AreEqual(ReduceStatus.Ignored, older.Status);

            var gap = RoomReducer.Apply(current, Room(5, "DDDDDD"), false);
            Assert.AreEqual(ReduceStatus.NeedsSync, gap.Status);
            Assert.AreEqual(3, gap.Room.revision);

            var snapshot = RoomReducer.Apply(current, Room(5, "DDDDDD"), true);
            Assert.AreEqual(ReduceStatus.Accepted, snapshot.Status);
            Assert.AreEqual("DDDDDD", snapshot.Room.code);
        }

        [Test]
        public void TurnRulesFollowServerPhase()
        {
            var room = new RoomDto
            {
                id = "room",
                kind = "custom",
                phase = "lobby",
                hostId = "a",
                players = new[]
                {
                    new PlayerDto { id = "a", ready = true, skipsRemaining = 1 },
                    new PlayerDto { id = "b", ready = false, skipsRemaining = 1 },
                },
            };
            Assert.IsFalse(GameRules.CanStart(room, "a"));
            room.players[1].ready = true;
            Assert.IsTrue(GameRules.CanStart(room, "a"));
            Assert.IsFalse(GameRules.CanStart(room, "b"));

            room.phase = "choosing";
            room.currentPlayerId = "b";
            Assert.IsTrue(GameRules.CanChoose(room, "b"));
            Assert.IsTrue(GameRules.CanSkip(room, "b"));
            Assert.IsFalse(GameRules.CanComplete(room, "b"));

            room.phase = "answering";
            room.players[1].skipsRemaining = 0;
            Assert.IsTrue(GameRules.CanComplete(room, "b"));
            Assert.IsFalse(GameRules.CanSkip(room, "b"));
            Assert.AreEqual(4, GameRules.MatchSize);
        }

        static RoomDto Room(int revision, string code)
        {
            return new RoomDto { id = "room", revision = revision, code = code, phase = "lobby" };
        }
    }
}
