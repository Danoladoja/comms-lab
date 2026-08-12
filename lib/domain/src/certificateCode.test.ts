import { describe, expect, it } from "vitest";
import {
  generateCertificateCode,
  normaliseCertificateCode,
  CERTIFICATE_CODE_PATTERN,
} from "./certificateCode";

describe("generateCertificateCode", () => {
  it("produces the printable AECL-XXXX-XXXX-XXXX shape", () => {
    expect(generateCertificateCode()).toMatch(CERTIFICATE_CODE_PATTERN);
  });

  it("is not enumerable — 500 codes, 500 distinct values", () => {
    const codes = new Set(Array.from({ length: 500 }, generateCertificateCode));
    expect(codes.size).toBe(500);
  });

  it("avoids characters that get misread from a printed certificate", () => {
    const body = Array.from({ length: 200 }, generateCertificateCode)
      .join("")
      .replace(/AECL|-/g, "");
    expect(body).not.toMatch(/[ILOU]/);
  });
});

describe("normaliseCertificateCode", () => {
  it("accepts a well-formed code unchanged", () => {
    const code = generateCertificateCode();
    expect(normaliseCertificateCode(code)).toBe(code);
  });

  it("fixes case and stray whitespace", () => {
    expect(normaliseCertificateCode("  aecl-7f3k-9qm2-xr41 ")).toBe("AECL-7F3K-9QM2-XR41");
  });

  it("tolerates a code typed without dashes", () => {
    expect(normaliseCertificateCode("AECL7F3K9QM2XR41")).toBe("AECL-7F3K-9QM2-XR41");
  });

  it("rejects the old enumerable format", () => {
    expect(normaliseCertificateCode("AECL-001-0042")).toBeNull();
  });

  it("rejects the wrong length and disallowed characters", () => {
    expect(normaliseCertificateCode("AECL-7F3K-9QM2")).toBeNull();
    expect(normaliseCertificateCode("AECL-IIII-OOOO-UUUU")).toBeNull();
  });
});
