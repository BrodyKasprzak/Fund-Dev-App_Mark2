import { Resend } from "resend";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export const resend = new Resend(mustEnv("RESEND_API_KEY"));

export function requireResendEnv() {
  mustEnv("RESEND_API_KEY");
  mustEnv("RESEND_FROM");
  mustEnv("APP_BASE_URL");
}


