namespace QDocHospitalApp.Models;

public sealed class PatientRecord
{
    public required string Id { get; init; }
    public required string Name { get; set; }
    public required string Contact { get; set; }
    public string AuthUserId { get; set; } = string.Empty;
    public required DateTime CreatedAt { get; init; }

    public string CreatedAtText => CreatedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
}
