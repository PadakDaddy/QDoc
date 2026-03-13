using System.IO;
using System.Text.RegularExpressions;

namespace QDocHospitalApp.Services;

public sealed class DatabaseConnectionResolver
{
    private const string OverrideEnvKey = "QDOC_HOSPITAL_DB_CONNECTION";
    private const string BackendDatabaseUrlKey = "DATABASE_URL";

    public DatabaseConnectionInfo Resolve()
    {
        var overrideConnection = Environment.GetEnvironmentVariable(OverrideEnvKey)?.Trim();
        if (!string.IsNullOrWhiteSpace(overrideConnection))
        {
            return new DatabaseConnectionInfo(overrideConnection, $"env:{OverrideEnvKey}");
        }

        var repositoryRoot = FindRepositoryRoot();
        if (repositoryRoot is null)
        {
            throw new InvalidOperationException("Could not locate repository root for the hospital app.");
        }

        var backendEnvPath = Path.Combine(repositoryRoot, "backend", ".env");
        if (!File.Exists(backendEnvPath))
        {
            throw new InvalidOperationException(
                "backend/.env was not found. Set QDOC_HOSPITAL_DB_CONNECTION or create backend/.env first.");
        }

        var databaseUrl = ReadDatabaseUrl(backendEnvPath);
        if (string.IsNullOrWhiteSpace(databaseUrl))
        {
            throw new InvalidOperationException("DATABASE_URL was not found in backend/.env.");
        }

        return new DatabaseConnectionInfo(ConvertPrismaUrlToAdoConnectionString(databaseUrl), backendEnvPath);
    }

    private static string? FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, ".git")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        return null;
    }

    private static string? ReadDatabaseUrl(string envPath)
    {
        foreach (var rawLine in File.ReadAllLines(envPath))
        {
            var line = rawLine.Trim();
            if (string.IsNullOrWhiteSpace(line) || line.StartsWith('#'))
            {
                continue;
            }

            if (!line.StartsWith($"{BackendDatabaseUrlKey}=", StringComparison.Ordinal))
            {
                continue;
            }

            var value = line[(BackendDatabaseUrlKey.Length + 1)..].Trim();
            if (value.StartsWith('"') && value.EndsWith('"') && value.Length >= 2)
            {
                value = value[1..^1];
            }

            return value;
        }

        return null;
    }

    private static string ConvertPrismaUrlToAdoConnectionString(string databaseUrl)
    {
        if (!databaseUrl.StartsWith("sqlserver://", StringComparison.OrdinalIgnoreCase))
        {
            return databaseUrl;
        }

        var payload = databaseUrl["sqlserver://".Length..];
        var parts = payload.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length == 0)
        {
            throw new InvalidOperationException("DATABASE_URL is malformed.");
        }

        var builder = new List<string>();
        var serverPart = parts[0].Replace(':', ',');
        builder.Add($"Server={serverPart}");

        foreach (var part in parts.Skip(1))
        {
            var separatorIndex = part.IndexOf('=');
            if (separatorIndex <= 0)
            {
                continue;
            }

            var key = part[..separatorIndex].Trim();
            var value = part[(separatorIndex + 1)..].Trim();
            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            builder.Add(key.ToLowerInvariant() switch
            {
                "database" => $"Database={value}",
                "user" => $"User ID={value}",
                "password" => $"Password={value}",
                "integratedsecurity" => $"Integrated Security={NormalizeBoolean(value)}",
                "encrypt" => $"Encrypt={NormalizeBoolean(value)}",
                "trustservercertificate" => $"TrustServerCertificate={NormalizeBoolean(value)}",
                _ => $"{key}={value}",
            });
        }

        if (!builder.Any(item => item.StartsWith("TrustServerCertificate=", StringComparison.OrdinalIgnoreCase)))
        {
            builder.Add("TrustServerCertificate=true");
        }

        return string.Join(';', builder);
    }

    private static string NormalizeBoolean(string value)
    {
        return value.Equals("true", StringComparison.OrdinalIgnoreCase) ? "True" : "False";
    }
}

public sealed record DatabaseConnectionInfo(string ConnectionString, string SourceDescription);
