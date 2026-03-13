namespace QDocHospitalApp.Models;

public sealed class HospitalOption
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string QueueStatus { get; init; }

    public string DisplayName => $"{Name} ({QueueStatus})";
}
