namespace QDocHospitalApp.Models;

public sealed class QueueOption
{
    public required string Id { get; init; }
    public required string HospitalId { get; init; }
    public required string HospitalName { get; init; }
    public required string DepartmentName { get; init; }
    public required string Status { get; init; }
    public required int AvgMin { get; init; }

    public string DisplayName => $"{DepartmentName} | {Status} | Avg {AvgMin} min";
}
