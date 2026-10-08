namespace Game.HotUpdate
{
    public enum ReduceStatus
    {
        Accepted,
        Ignored,
        NeedsSync,
    }

    public readonly struct ReduceResult
    {
        public ReduceResult(ReduceStatus status, RoomDto room)
        {
            Status = status;
            Room = room;
        }

        public ReduceStatus Status { get; }
        public RoomDto Room { get; }
    }

    public static class RoomReducer
    {
        public static ReduceResult Apply(RoomDto current, RoomDto incoming, bool snapshot)
        {
            if (incoming == null || string.IsNullOrEmpty(incoming.id))
            {
                return new ReduceResult(ReduceStatus.Ignored, current);
            }

            if (current == null || string.IsNullOrEmpty(current.id))
            {
                return new ReduceResult(ReduceStatus.Accepted, incoming);
            }

            if (incoming.revision < current.revision)
            {
                return new ReduceResult(ReduceStatus.Ignored, current);
            }

            if (incoming.revision == current.revision)
            {
                return new ReduceResult(ReduceStatus.Ignored, current);
            }

            if (snapshot || incoming.revision == current.revision + 1)
            {
                return new ReduceResult(ReduceStatus.Accepted, incoming);
            }

            return new ReduceResult(ReduceStatus.NeedsSync, current);
        }
    }
}
