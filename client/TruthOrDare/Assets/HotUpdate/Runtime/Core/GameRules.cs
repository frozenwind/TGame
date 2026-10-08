using System;

namespace Game.HotUpdate
{
    public static class GameRules
    {
        public const int MatchSize = 4;

        public static PlayerDto Find(RoomDto room, string playerId)
        {
            if (room?.players == null || string.IsNullOrEmpty(playerId)) return null;
            foreach (var player in room.players)
            {
                if (player != null && player.id == playerId) return player;
            }
            return null;
        }

        public static bool CanChoose(RoomDto room, string playerId)
        {
            return room != null && room.phase == "choosing" && room.currentPlayerId == playerId;
        }

        public static bool CanComplete(RoomDto room, string playerId)
        {
            return room != null && room.phase == "answering" && room.currentPlayerId == playerId;
        }

        public static bool CanSkip(RoomDto room, string playerId)
        {
            var player = Find(room, playerId);
            var acting = room != null && (room.phase == "choosing" || room.phase == "answering") && room.currentPlayerId == playerId;
            return acting && player != null && player.skipsRemaining > 0;
        }

        public static bool CanStart(RoomDto room, string playerId)
        {
            return room != null
                && room.kind == "custom"
                && room.phase == "lobby"
                && room.hostId == playerId
                && room.players != null
                && room.players.Length >= 2
                && Array.TrueForAll(room.players, player => player != null && player.ready);
        }

        public static string PhaseLabel(RoomDto room)
        {
            if (room == null) return "";
            switch (room.phase)
            {
                case "lobby": return "等待开始";
                case "choosing": return "选择真心话或大冒险";
                case "answering": return "完成题目";
                case "resolving": return "揭晓结果";
                default: return room.phase;
            }
        }
    }
}
