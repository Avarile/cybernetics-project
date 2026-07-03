import { describe, it, expect } from "vitest";
import { renderMagicCodeEmail } from './magic-email';

describe('renderMagicCodeEmail', () => {
  it('should return an object with subject, html, and text properties', () => {
    const result = renderMagicCodeEmail('123456');
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('text');
  });

  it('should include the code in the subject matching Django format', () => {
    const code = '123456';
    const result = renderMagicCodeEmail(code);
    expect(result.subject).toBe(`Your unique Plane login code is ${code}`);
  });

  it('should include the code in the html', () => {
    const code = '123456';
    const result = renderMagicCodeEmail(code);
    expect(result.html).toContain(code);
  });

  it('should include the code in the text', () => {
    const code = '123456';
    const result = renderMagicCodeEmail(code);
    expect(result.text).toContain(code);
  });

  it('should return non-empty strings for all properties', () => {
    const result = renderMagicCodeEmail('123456');
    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('should produce valid HTML with DOCTYPE declaration', () => {
    const result = renderMagicCodeEmail('654321');
    expect(result.html).toMatch(/^<!DOCTYPE html>/i);
  });
});
