// First reporter in playwright.config: masks secrets before the html/blob/list reporters see or copy anything.
// Reporters are called in order and these hooks are synchronous, so by the time the next reporter runs the step
// title, the error text and every attachment file (trace.zip, error-context.md) are already masked.
import type { Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";
import { MASK, isText, redactFile, redactText, secretValues } from "./redact";

export default class RedactReporter implements Reporter {
  private readonly secrets = secretValues();

  printsToStdio() { return false; }

  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep) { this.step(step); }
  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep) { this.step(step); }

  onTestEnd(_test: TestCase, result: TestResult) {
    for (const error of result.errors) {
      if (error.message) error.message = redactText(error.message, this.secrets);
      if (error.stack) error.stack = redactText(error.stack, this.secrets);
      if (error.snippet) error.snippet = redactText(error.snippet, this.secrets);
    }
    for (const attachment of result.attachments) {
      if (attachment.path) {
        try { redactFile(attachment.path, this.secrets); } catch (e) { console.error(`[redact] ${attachment.path}: ${(e as Error).message}`); }
      }
      if (attachment.body && isText(attachment.body)) attachment.body = Buffer.from(redactText(attachment.body.toString("utf8"), this.secrets));
    }
  }

  private step(step: TestStep) {
    // Besides the public title, API steps carry their call (`subtitle`, `params`), which blob reports serialize.
    const s = step as TestStep & { title: string; subtitle?: string; params?: Record<string, unknown> };
    s.title = redactText(s.title, this.secrets);
    if (s.params) {
      for (const [k, v] of Object.entries(s.params)) if (typeof v === "string") s.params[k] = redactText(v, this.secrets);
    }
    // A password field filled with any value (our test ids say "password"): mask the value in the title and params.
    const target = `${s.subtitle ?? ""} ${typeof s.params?.["locator"] === "string" ? s.params["locator"] : ""}`;
    if (/password/i.test(target) && /^(Fill|Type|Press sequentially) "/.test(s.title)) {
      s.title = s.title.replace(/"[\s\S]*"/, `"${MASK}"`);
      if (s.params && "value" in s.params) s.params["value"] = MASK;
      if (s.params && "text" in s.params) s.params["text"] = MASK;
    }
  }
}
