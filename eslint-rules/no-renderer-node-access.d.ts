// T-260901-19: the rule stays plain JavaScript (eslint.config.js loads it
// without a build step); this declaration is what lets its test be
// typechecked alongside every other test file instead of running unchecked.
import type { Rule } from 'eslint'

export const noRendererNodeAccess: Rule.RuleModule
