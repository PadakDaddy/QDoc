namespace QDocHospitalApp.Models;

public sealed class QueueTicketRecord
{
    public required string Id { get; init; }
    public required string QueueId { get; init; }
    public required int QueueNumber { get; init; }
    public required string PatientName { get; init; }
    public required string Status { get; set; }
    public required DateTime CreatedAt { get; init; }
    public required DateTime UpdatedAt { get; set; }
    public required string Stage1State { get; set; }
    public required string Stage2State { get; set; }

    public string CreatedAtText => CreatedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
    public string UpdatedAtText => UpdatedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
}
