using System.Data;
using Microsoft.Data.SqlClient;
using QDocHospitalApp.Models;

namespace QDocHospitalApp.Services;

public sealed class SqlServerClinicRepository
{
    private readonly string _connectionString;

    public SqlServerClinicRepository(string connectionString)
    {
        _connectionString = connectionString;
    }

    public async Task<IReadOnlyList<HospitalOption>> GetHospitalsAsync()
    {
        const string sql = """
            SELECT id, name, queueStatus
            FROM Hospital
            ORDER BY name;
            """;

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();

        var items = new List<HospitalOption>();
        while (await reader.ReadAsync())
        {
            items.Add(new HospitalOption
            {
                Id = reader.GetString(0),
                Name = reader.GetString(1),
                QueueStatus = reader.GetString(2),
            });
        }

        return items;
    }

    public async Task<IReadOnlyList<QueueOption>> GetQueuesAsync(string hospitalId)
    {
        const string sql = """
            SELECT q.id,
                   q.hospitalId,
                   h.name,
                   COALESCE(d.name, 'General') AS departmentName,
                   q.status,
                   q.avgMin
            FROM Queue q
            INNER JOIN Hospital h ON h.id = q.hospitalId
            LEFT JOIN Department d ON d.id = q.departmentId
            WHERE q.hospitalId = @hospitalId
            ORDER BY departmentName;
            """;

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@hospitalId", hospitalId);
        await using var reader = await command.ExecuteReaderAsync();

        var items = new List<QueueOption>();
        while (await reader.ReadAsync())
        {
            items.Add(new QueueOption
            {
                Id = reader.GetString(0),
                HospitalId = reader.GetString(1),
                HospitalName = reader.GetString(2),
                DepartmentName = reader.GetString(3),
                Status = reader.GetString(4),
                AvgMin = reader.GetInt32(5),
            });
        }

        return items;
    }

    public async Task<IReadOnlyList<PatientRecord>> GetPatientsAsync()
    {
        const string sql = """
            SELECT id,
                   name,
                   ISNULL(phone, ''),
                   ISNULL(authUserId, ''),
                   createdAt
            FROM Customer
            ORDER BY createdAt DESC;
            """;

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();

        var items = new List<PatientRecord>();
        while (await reader.ReadAsync())
        {
            items.Add(new PatientRecord
            {
                Id = reader.GetString(0),
                Name = reader.GetString(1),
                Contact = reader.GetString(2),
                AuthUserId = reader.GetString(3),
                CreatedAt = reader.GetDateTime(4),
            });
        }

        return items;
    }

    public async Task<PatientRecord> AddPatientAsync(string name, string contact, string authUserId)
    {
        const string sql = """
            INSERT INTO Customer (id, authUserId, name, phone, createdAt, updatedAt)
            VALUES (@id, @authUserId, @name, @phone, SYSUTCDATETIME(), SYSUTCDATETIME());
            """;

        var record = new PatientRecord
        {
            Id = $"cust-{Guid.NewGuid():N}"[..18],
            Name = name,
            Contact = contact,
            AuthUserId = authUserId,
            CreatedAt = DateTime.UtcNow,
        };

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@id", record.Id);
        command.Parameters.AddWithValue("@authUserId", string.IsNullOrWhiteSpace(record.AuthUserId) ? DBNull.Value : record.AuthUserId);
        command.Parameters.AddWithValue("@name", record.Name);
        command.Parameters.AddWithValue("@phone", string.IsNullOrWhiteSpace(record.Contact) ? DBNull.Value : record.Contact);
        await command.ExecuteNonQueryAsync();

        return record;
    }

    public async Task UpdatePatientAsync(PatientRecord patient)
    {
        const string sql = """
            UPDATE Customer
            SET name = @name,
                phone = @phone,
                authUserId = @authUserId,
                updatedAt = SYSUTCDATETIME()
            WHERE id = @id;
            """;

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@id", patient.Id);
        command.Parameters.AddWithValue("@name", patient.Name);
        command.Parameters.AddWithValue("@phone", string.IsNullOrWhiteSpace(patient.Contact) ? DBNull.Value : patient.Contact);
        command.Parameters.AddWithValue("@authUserId", string.IsNullOrWhiteSpace(patient.AuthUserId) ? DBNull.Value : patient.AuthUserId);
        await command.ExecuteNonQueryAsync();
    }

    public async Task DeletePatientAsync(string patientId)
    {
        const string sql = "DELETE FROM Customer WHERE id = @id;";

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@id", patientId);
        await command.ExecuteNonQueryAsync();
    }

    public async Task UpdateQueueStatusAsync(string queueId, string queueStatus)
    {
        const string sql = """
            DECLARE @hospitalId VARCHAR(64);
            SELECT @hospitalId = hospitalId FROM Queue WHERE id = @queueId;

            UPDATE Queue
            SET status = @status,
                updatedAt = SYSUTCDATETIME()
            WHERE id = @queueId;

            UPDATE Hospital
            SET queueStatus = @status,
                updatedAt = SYSUTCDATETIME()
            WHERE id = @hospitalId;
            """;

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@queueId", queueId);
        command.Parameters.AddWithValue("@status", queueStatus);
        await command.ExecuteNonQueryAsync();

        await CaptureSnapshotAsync(connection, queueId, "WpfQueueStatus");
    }

    public async Task<IReadOnlyList<QueueTicketRecord>> GetTicketsAsync(string queueId)
    {
        const string sql = """
            SELECT t.id,
                   t.queueId,
                   t.ticketNumber,
                   c.name,
                   t.status,
                   t.createdAt,
                   t.updatedAt,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM NotificationLog n
                       WHERE n.ticketId = t.id AND n.stage = 'Stage1'
                   ) THEN 'Sent' ELSE 'Pending' END AS stage1State,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM NotificationLog n
                       WHERE n.ticketId = t.id AND n.stage = 'Stage2'
                   ) THEN 'Sent' ELSE 'Pending' END AS stage2State
            FROM QueueTicket t
            INNER JOIN Customer c ON c.id = t.customerId
            WHERE t.queueId = @queueId
            ORDER BY t.ticketNumber ASC;
            """;

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@queueId", queueId);
        await using var reader = await command.ExecuteReaderAsync();

        var items = new List<QueueTicketRecord>();
        while (await reader.ReadAsync())
        {
            items.Add(new QueueTicketRecord
            {
                Id = reader.GetString(0),
                QueueId = reader.GetString(1),
                QueueNumber = reader.GetInt32(2),
                PatientName = reader.GetString(3),
                Status = reader.GetString(4),
                CreatedAt = reader.GetDateTime(5),
                UpdatedAt = reader.GetDateTime(6),
                Stage1State = reader.GetString(7),
                Stage2State = reader.GetString(8),
            });
        }

        return items;
    }

    public async Task<int> AddTicketAsync(string queueId, string customerId)
    {
        const string sql = """
            SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
            BEGIN TRANSACTION;

            DECLARE @nextTicketNumber INT;
            SELECT @nextTicketNumber = ISNULL(MAX(ticketNumber), 100) + 1
            FROM QueueTicket WITH (UPDLOCK, HOLDLOCK)
            WHERE queueId = @queueId;

            INSERT INTO QueueTicket (id, queueId, customerId, status, ticketNumber, createdAt, updatedAt)
            VALUES (@ticketId, @queueId, @customerId, 'Waiting', @nextTicketNumber, SYSUTCDATETIME(), SYSUTCDATETIME());

            COMMIT TRANSACTION;

            SELECT @nextTicketNumber;
            """;

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@queueId", queueId);
        command.Parameters.AddWithValue("@customerId", customerId);
        command.Parameters.AddWithValue("@ticketId", $"ticket-{Guid.NewGuid():N}"[..20]);
        var nextTicketNumber = (int)(await command.ExecuteScalarAsync() ?? 0);

        await CaptureSnapshotAsync(connection, queueId, "WpfEnroll");
        return nextTicketNumber;
    }

    public async Task UpdateTicketStatusAsync(string ticketId, string status)
    {
        const string sql = """
            DECLARE @queueId VARCHAR(64);
            SELECT @queueId = queueId FROM QueueTicket WHERE id = @ticketId;

            UPDATE QueueTicket
            SET status = @status,
                calledAt = CASE WHEN @status = 'Called' THEN SYSUTCDATETIME() ELSE calledAt END,
                completedAt = CASE WHEN @status IN ('Done', 'NoShow') THEN SYSUTCDATETIME() ELSE completedAt END,
                cancelledReason = CASE WHEN @status = 'Cancelled' THEN 'Cancelled by hospital staff' ELSE cancelledReason END,
                updatedAt = SYSUTCDATETIME()
            WHERE id = @ticketId;

            SELECT @queueId;
            """;

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@ticketId", ticketId);
        command.Parameters.AddWithValue("@status", status);
        var queueId = (string?)await command.ExecuteScalarAsync();

        if (!string.IsNullOrWhiteSpace(queueId))
        {
            await CaptureSnapshotAsync(connection, queueId, $"Wpf{status}");
        }
    }

    public async Task<bool> AddNotificationStageAsync(string ticketId, string stage)
    {
        const string sql = """
            IF NOT EXISTS (
                SELECT 1
                FROM NotificationLog
                WHERE ticketId = @ticketId AND stage = @stage
            )
            BEGIN
                INSERT INTO NotificationLog (id, ticketId, stage, sentAt)
                VALUES (@id, @ticketId, @stage, SYSUTCDATETIME());
                SELECT CAST(1 AS BIT);
            END
            ELSE
            BEGIN
                SELECT CAST(0 AS BIT);
            END
            """;

        await using var connection = CreateConnection();
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@id", $"notify-{Guid.NewGuid():N}"[..20]);
        command.Parameters.AddWithValue("@ticketId", ticketId);
        command.Parameters.AddWithValue("@stage", stage);
        return (bool)(await command.ExecuteScalarAsync() ?? false);
    }

    private async Task CaptureSnapshotAsync(SqlConnection connection, string queueId, string source)
    {
        const string sql = """
            DECLARE @hospitalId VARCHAR(64);
            DECLARE @avgMin INT;
            DECLARE @waitingCount INT;

            SELECT @hospitalId = hospitalId, @avgMin = avgMin
            FROM Queue
            WHERE id = @queueId;

            SELECT @waitingCount = COUNT(*)
            FROM QueueTicket
            WHERE queueId = @queueId AND status IN ('Waiting', 'Called', 'InService');

            INSERT INTO WaitTimeSnapshot (id, hospitalId, queueId, source, averageMinutes, waitingCount, capturedAt)
            VALUES (@id, @hospitalId, @queueId, @source, ISNULL(@avgMin, 5), ISNULL(@waitingCount, 0), SYSUTCDATETIME());
            """;

        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@id", $"snap-{Guid.NewGuid():N}"[..18]);
        command.Parameters.AddWithValue("@queueId", queueId);
        command.Parameters.AddWithValue("@source", source);
        await command.ExecuteNonQueryAsync();
    }

    private SqlConnection CreateConnection() => new(_connectionString);
}
