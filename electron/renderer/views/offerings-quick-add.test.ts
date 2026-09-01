import { describe, expect, it } from 'vitest'
import { parseQuickAddOffering } from './offerings-quick-add'

/**
 * §6.5's three quick-add forms, which are also T-260901-07's own acceptance:
 * `Name, 4500` is a flat fixed price, `Name, 4500/mo` is a monthly retainer,
 * `Name, 175/hr` is hourly T&M. One assertion per form, on both the unit the
 * rate is quoted in and the billing model it implies — the two are what the
 * grammar exists to decide, and a parser that got the unit right and the
 * model wrong would produce a catalogue that reads correctly and bills
 * wrongly.
 */
describe('parseQuickAddOffering', () => {
  it('parses "Audit, 4500" as a flat fixed price', () => {
    const result = parseQuickAddOffering('Audit, 4500')
    expect(result).toEqual({
      ok: true,
      value: { name: 'Audit', rateCents: 450_000, unit: 'fixed', billingModel: 'fixed' }
    })
  })

  it('parses "Retainer, 4500/mo" as a monthly retainer', () => {
    const result = parseQuickAddOffering('Retainer, 4500/mo')
    expect(result).toEqual({
      ok: true,
      value: { name: 'Retainer', rateCents: 450_000, unit: 'mo', billingModel: 'retainer' }
    })
  })

  it('parses "Advisory, 175/hr" as hourly T&M', () => {
    const result = parseQuickAddOffering('Advisory, 175/hr')
    expect(result).toEqual({
      ok: true,
      value: { name: 'Advisory', rateCents: 17_500, unit: 'hr', billingModel: 'tm' }
    })
  })

  it('keeps a name that contains the separator characters intact', () => {
    // The seed's own `Systems / Agent Audit` — the name group is lazy, so a
    // slash and a space inside the name must not be read as the price split.
    const result = parseQuickAddOffering('Systems / Agent Audit, 4200')
    expect(result.ok && result.value.name).toBe('Systems / Agent Audit')
    expect(result.ok && result.value.rateCents).toBe(420_000)
  })

  it('accepts a space instead of a comma, a $ sign, and thousands separators', () => {
    expect(parseQuickAddOffering('Retainer $6,500/mo')).toEqual({
      ok: true,
      value: { name: 'Retainer', rateCents: 650_000, unit: 'mo', billingModel: 'retainer' }
    })
  })

  it('carries cents through exactly rather than rounding them into the dollars', () => {
    // The mockup multiplied a parsed integer by 100 and had no way to express
    // this at all; CONVENTIONS.md makes money integer cents, so 175.50 has to
    // arrive as 17550, not 17500 and not 1755000.
    expect(parseQuickAddOffering('Advisory, 175.50/hr')).toEqual({
      ok: true,
      value: { name: 'Advisory', rateCents: 17_550, unit: 'hr', billingModel: 'tm' }
    })
  })

  it('is case-insensitive about the unit suffix', () => {
    expect(parseQuickAddOffering('Retainer, 4500/MO')).toEqual({
      ok: true,
      value: { name: 'Retainer', rateCents: 450_000, unit: 'mo', billingModel: 'retainer' }
    })
  })

  it('refuses text with no price instead of inventing a free offering', () => {
    // The behaviour that matters most here: the mockup fell back to rate 0,
    // which silently created a $0 catalogue entry. `rateCents` is required on
    // the wire precisely so that cannot happen, and this is the renderer half
    // of the same rule.
    const result = parseQuickAddOffering('Just a name')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('has no price')
  })

  it('refuses a bare price with no name', () => {
    const result = parseQuickAddOffering(', 4500')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('has no name')
  })

  it('refuses more precision than a cent can hold rather than rounding it away', () => {
    const result = parseQuickAddOffering('Advisory, 175.505/hr')
    expect(result.ok).toBe(false)
  })
})
