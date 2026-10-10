const nodemailer = require("nodemailer");

function mailConfig() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
    from: process.env.SMTP_FROM || user,
  };
}

async function sendLoginCode(to, code, { name, role } = {}) {
  const config = mailConfig();
  if (!config) {
    const error = new Error("Email delivery is not configured");
    error.code = "MAIL_UNCONFIGURED";
    throw error;
  }

  const accountLabel = role === "owner" ? "dorm owner account" : "account";
  const greeting = name ? `Hello ${name},` : "Hello,";
  const text = [
    greeting,
    "",
    "You are logging in on Pagdagusan.",
    "",
    `Use this code to finish signing in to your ${accountLabel}:`,
    "",
    code,
    "",
    "This code expires in 10 minutes. If you did not try to log in on Pagdagusan, ignore this email.",
  ].join("\n");

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  await transporter.sendMail({
    from: config.from,
    to,
    subject: "You are logging in on Pagdagusan",
    text,
    html: `<p>${greeting}</p><p><strong>You are logging in on Pagdagusan.</strong></p><p>Use this code to finish signing in to your ${accountLabel}:</p><p style="font-size:24px;letter-spacing:4px"><strong>${code}</strong></p><p>This code expires in 10 minutes. If you did not try to log in on Pagdagusan, ignore this email.</p>`,
  });
}

async function sendPasswordReset(to, code, { name, role } = {}) {
  const config = mailConfig();
  if (!config) {
    const error = new Error("Email delivery is not configured");
    error.code = "MAIL_UNCONFIGURED";
    throw error;
  }

  const accountLabel =
    role === "owner" ? "Dorm Owner" : role === "admin" ? "Admin" : role === "tenant" ? "Tenant" : "Pagdagusan";
  const greeting = name ? `Hello ${name},` : "Hello,";
  const text = [
    greeting,
    "",
    `Use this code to reset the password for your ${accountLabel} account:`,
    "",
    code,
    "",
    "This code expires in 10 minutes. If you did not ask to reset your password, ignore this email.",
  ].join("\n");

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  await transporter.sendMail({
    from: config.from,
    to,
    subject: "Reset your Pagdagusan password",
    text,
    html: `<p>${greeting}</p><p>Use this code to reset the password for your ${accountLabel} account:</p><p style="font-size:24px;letter-spacing:4px"><strong>${code}</strong></p><p>This code expires in 10 minutes. If you did not ask to reset your password, ignore this email.</p>`,
  });
}

module.exports = { sendLoginCode, sendPasswordReset, mailConfig };
