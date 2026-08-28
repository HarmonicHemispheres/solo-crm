/**
 * @fileoverview Local ESLint rule for T-260828-11: colour lives in
 * electron/renderer/styles/tokens.css and nowhere else. A component that
 * writes `#5BA4A4` or `rgba(91,164,164,.3)` instead of `var(--verdigris)`
 * (or `color-mix(in srgb, var(--verdigris) 30%, transparent)`) breaks the
 * acceptance test "changing --verdigris moves every surface using it" —
 * this rule is what makes `npm run lint` catch that instead of a reviewer
 * having to.
 *
 * Two rule bodies share one detector: `no-literal-colour` for JS/TS
 * (string literals and template-literal chunks — inline `style={{}}`
 * objects, mostly) and `no-literal-colour-css` for CSS declaration values,
 * registered against @eslint/css's `Declaration` node. `var(...)` and
 * `color-mix(...)` are untouched by design — those are how a component is
 * supposed to reference colour.
 */

/** Hex colours: #rgb, #rgba, #rrggbb, #rrggbbaa. */
const HEX_COLOUR = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/

/** rgb()/rgba()/hsl()/hsla() function calls — not color-mix(), not var(). */
const COLOUR_FUNCTION = /\b(?:rgb|rgba|hsl|hsla)\s*\(/i

/**
 * @param {string} text
 * @returns {boolean}
 */
function containsLiteralColour(text) {
  return HEX_COLOUR.test(text) || COLOUR_FUNCTION.test(text)
}

const messages = {
  literalColour:
    'Literal colour value found ({{snippet}}). Reference a token from electron/renderer/styles/tokens.css instead (var(--token), or color-mix(in srgb, var(--token) N%, transparent) for an alpha overlay).'
}

/** @type {import('eslint').Rule.RuleModule} */
export const noLiteralColourJs = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hex/rgb()/hsl() colour literals in component source — colour comes from tokens.css.'
    },
    schema: [],
    messages
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return
        if (!containsLiteralColour(node.value)) return
        context.report({ node, messageId: 'literalColour', data: { snippet: node.value } })
      },
      TemplateElement(node) {
        const text = node.value.raw
        if (!containsLiteralColour(text)) return
        context.report({ node, messageId: 'literalColour', data: { snippet: text.trim() } })
      }
    }
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export const noLiteralColourCss = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hex/rgb()/hsl() colour literals in component stylesheets — colour comes from tokens.css.'
    },
    schema: [],
    messages
  },
  create(context) {
    const { sourceCode } = context
    return {
      Declaration(node) {
        const text = sourceCode.getText(node)
        if (!containsLiteralColour(text)) return
        const match = HEX_COLOUR.exec(text) || COLOUR_FUNCTION.exec(text)
        context.report({ node, messageId: 'literalColour', data: { snippet: match ? match[0] : text.trim() } })
      }
    }
  }
}
