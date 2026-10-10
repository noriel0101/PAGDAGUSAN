const dns = require("dns").promises;

// A real mailbox: a normal address, a public domain, and a domain that can receive mail.
const EMAIL_PATTERN =
  /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const BLOCKED_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "test.org",
  "mailinator.com",
  "yopmail.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "trashmail.com",
  "fake.com",
  "email.com",
]);

const BLOCKED_TLDS = new Set(["test", "invalid", "example", "localhost"]);

const COMMON_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "ymail.com",
  "googlemail.com",
];

function isOneEdit(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    let first = -1;
    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        diffs += 1;
        if (first < 0) first = i;
        if (diffs > 2) return false;
      }
    }
    if (diffs === 1) return true;
    return (
      diffs === 2 &&
      a[first] === b[first + 1] &&
      a[first + 1] === b[first] &&
      a.slice(first + 2) === b.slice(first + 2)
    );
  }

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      j += 1;
    }
  }
  return true;
}

function emailTypoError(email) {
  const value = String(email || "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return null;

  const domain = value.slice(at + 1);
  if (COMMON_DOMAINS.includes(domain)) return null;

  const match = COMMON_DOMAINS.find((known) => isOneEdit(domain, known));
  if (!match) return null;
  return `That email looks misspelled. Did you mean ${match}?`;
}

function formatError(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return "Email address is required";
  if (value.length > 254 || value.includes("..") || !EMAIL_PATTERN.test(value)) {
    return "Enter a real email address, like name@gmail.com";
  }

  const domain = value.slice(value.lastIndexOf("@") + 1);
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (tld.length < 2 || BLOCKED_TLDS.has(tld) || BLOCKED_DOMAINS.has(domain)) {
    return "Enter a real email address. That domain cannot be used to register.";
  }

  return emailTypoError(value);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const error = new Error("timeout");
      error.code = "ETIMEOUT";
      setTimeout(() => reject(error), ms);
    }),
  ]);
}

async function domainCanReceiveMail(domain) {
  try {
    const records = await withTimeout(dns.resolveMx(domain), 4000);
    return (
      Array.isArray(records) &&
      records.some((record) => {
        const exchange = String(record.exchange || "")
          .trim()
          .replace(/\.$/, "")
          .toLowerCase();
        return exchange.length > 0;
      })
    );
  } catch (error) {
    if (error.code === "ENOTFOUND" || error.code === "ENODATA" || error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertLegitEmail(email) {
  const format = formatError(email);
  if (format) {
    return { ok: false, message: format };
  }

  const value = String(email).trim().toLowerCase();
  const domain = value.slice(value.lastIndexOf("@") + 1);

  try {
    const reachable = await domainCanReceiveMail(domain);
    if (!reachable) {
      return {
        ok: false,
        message: "Enter a real email address. That domain cannot receive mail.",
      };
    }
  } catch {
    return {
      ok: false,
      message: "We could not confirm that email domain. Check the address and try again.",
    };
  }

  return { ok: true, email: value };
}

module.exports = { assertLegitEmail, formatError, emailTypoError };
