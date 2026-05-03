import nodemailer, { type Transporter } from "nodemailer";

type EmailProvider = "console" | "smtp";

let smtpTransporter: Transporter | null = null;

export class OtpDeliveryError extends Error {
  constructor(message = "OTP delivery is unavailable") {
    super(message);
    this.name = "OtpDeliveryError";
  }
}

function getEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER;

  if (!provider || provider === "console") {
    return "console";
  }

  if (provider === "smtp") {
    return "smtp";
  }

  throw new Error("Unsupported EMAIL_PROVIDER");
}

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function getSmtpPort() {
  const rawPort = process.env.SMTP_PORT ?? "587";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port");
  }

  return port;
}

function getSmtpSecure() {
  return process.env.SMTP_SECURE === "true";
}

function getSmtpTransporter() {
  validateSmtpConfig();

  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: getRequiredEnv("SMTP_HOST"),
      port: getSmtpPort(),
      secure: getSmtpSecure(),
      requireTLS: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: {
        user: getRequiredEnv("SMTP_USER"),
        pass: getRequiredEnv("SMTP_PASS"),
      },
    });
  }

  return smtpTransporter;
}

function validateSmtpConfig() {
  getRequiredEnv("EMAIL_FROM");
  getRequiredEnv("SMTP_HOST");
  getSmtpPort();
  getRequiredEnv("SMTP_USER");
  getRequiredEnv("SMTP_PASS");
}

function hasUsableSmtpConfig() {
  try {
    validateSmtpConfig();
    return true;
  } catch {
    return false;
  }
}

function canUseConsoleDelivery() {
  return (
    getEmailProvider() === "console" &&
    (process.env.NODE_ENV !== "production" ||
      (process.env.APP_ENV === "staging" && process.env.ALLOW_CONSOLE_OTP === "true"))
  );
}

export function canDeliverOtp() {
  let provider: EmailProvider;

  try {
    provider = getEmailProvider();
  } catch {
    return false;
  }

  if (provider === "smtp") {
    return hasUsableSmtpConfig();
  }

  return canUseConsoleDelivery();
}

export function getEmailDeliveryHealth() {
  let provider: EmailProvider;

  try {
    provider = getEmailProvider();
  } catch {
    return { ok: false, provider: "unknown" };
  }

  if (provider === "smtp") {
    return { ok: hasUsableSmtpConfig(), provider };
  }

  return { ok: canUseConsoleDelivery(), provider };
}

export async function deliverOtp(email: string, code: string) {
  const provider = getEmailProvider();

  if (provider === "smtp") {
    if (!hasUsableSmtpConfig()) {
      throw new OtpDeliveryError();
    }

    try {
      await getSmtpTransporter().sendMail({
        from: getRequiredEnv("EMAIL_FROM"),
        to: email,
        subject: "QDoc verification code",
        text: `Your QDoc verification code is ${code}. This code expires in 10 minutes.`,
        html: `<p>Your QDoc verification code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`,
      });
    } catch {
      throw new OtpDeliveryError();
    }
    return;
  }

  if (!canUseConsoleDelivery()) {
    throw new OtpDeliveryError();
  }

  console.log(`QDoc OTP for ${email}: ${code}`);
}
