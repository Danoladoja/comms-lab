import { describe, expect, it } from "vitest";
import { describeEmailFailure, providerDetail } from "./emailFailure";

/** The real one, from the afternoon this module exists because of. */
const IP_REFUSAL =
  'Brevo send failed: 401 {"message":"We have detected you are using an unrecognised IP address 152.55.176.254. If you performed this action make sure to add the new IP address in this link: https://app.brevo.com/security/authorised_ips","code":"unauthorized"}';

describe("describeEmailFailure", () => {
  it("names the address when the provider refuses the server", () => {
    const said = describeEmailFailure(new Error(IP_REFUSAL));
    expect(said).toContain("152.55.176.254");
    expect(said).toMatch(/authorised addresses|restriction/i);
  });

  it("says the address changes on restart, because that is the part people miss", () => {
    // Adding the one address looks like a fix and lasts until the next deploy.
    expect(describeEmailFailure(new Error(IP_REFUSAL))).toMatch(/restarts/i);
  });

  it("reports a rejected key as a credentials problem", () => {
    const said = describeEmailFailure(new Error("Brevo rejected the API key (401). Check BREVO_API_KEY."));
    expect(said).toMatch(/credentials/i);
  });

  it("reports an unverified sender as a sender problem", () => {
    const said = describeEmailFailure(
      new Error('Brevo send failed: 400 {"message":"sender email is not valid","code":"invalid_parameter"}'),
    );
    expect(said).toMatch(/sender/i);
    expect(said).toContain("sender email is not valid");
  });

  it("mentions the allowance when the provider talks about credits", () => {
    const said = describeEmailFailure(new Error('{"message":"Not enough credits to send"}'));
    expect(said).toMatch(/allowance/i);
  });

  it("passes anything else through in the provider's own words", () => {
    const said = describeEmailFailure(new Error('{"message":"Temporary failure, try later"}'));
    expect(said).toContain("Temporary failure, try later");
  });

  it("says so plainly when there is nothing to report", () => {
    expect(describeEmailFailure(new Error(""))).toMatch(/no reason/i);
    expect(describeEmailFailure(undefined)).toMatch(/no reason/i);
  });
});

describe("what never reaches the screen", () => {
  it("removes anything shaped like an API key", () => {
    // A key has ended up in an error message before. It must not then be
    // rendered into a browser and copied into a support thread.
    const said = describeEmailFailure(
      new Error('{"message":"bad key xkeysib-abc123DEF456-ghi789 supplied"}'),
    );
    expect(said).not.toContain("xkeysib-abc123DEF456-ghi789");
    expect(said).toContain("(key)");
  });

  it("removes an SMTP credential too", () => {
    const said = describeEmailFailure(new Error('{"message":"xsmtpsib-zzz999 rejected"}'));
    expect(said).not.toContain("xsmtpsib-zzz999");
  });

  it("removes a bearer token", () => {
    const said = describeEmailFailure(new Error("Bearer eyJhbGciOiJIUzI1NiJ9.abc.def was rejected"));
    expect(said).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("keeps the message short enough to read", () => {
    const said = describeEmailFailure(new Error(`{"message":"${"x".repeat(1000)}"}`));
    expect(said.length).toBeLessThan(300);
  });
});

describe("providerDetail", () => {
  it("digs the sentence out of a JSON body", () => {
    expect(providerDetail(new Error('500 {"message":"upstream said no","code":"x"}'))).toBe("upstream said no");
  });

  it("takes a plain string as it is", () => {
    expect(providerDetail("something went wrong")).toBe("something went wrong");
  });

  it("copes with anything that is not an error at all", () => {
    expect(providerDetail(null)).toBe("");
    expect(providerDetail(42)).toBe("");
  });
});
