/**
 * QuickForm Autofill & Form Filler Engine
 * High-performance, declarative data-injection utility for structured JSON schemas.
 */

import { $ } from "./utils.js";

// field.id is attacker/editor-controlled data (it comes from the form
// builder's JSON schema, not a hardcoded constant), and it was being
// interpolated straight into querySelector() strings below. A field.id
// containing a `"` or other CSS-special character (e.g. `foo"]`, `1abc`,
// `a.b`) either breaks the selector's syntax — throwing a SyntaxError that
// previously killed the whole forEach loop, so every field *after* the bad
// one silently never got filled — or, worse, lets it escape the intended
// attribute-selector segment. CSS.escape() neutralizes both.
const escapeCss = (value) => {
  const str = String(value ?? '');
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(str) : str.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
};

export const QuickForm = {
  /**
   * Scans a target container on the DOM and fills all matching form elements 
   * based on a provided mock or system dataset profile.
   * * @param {Array} schema - The original JSON form schema from your FormBuilder.
   * @param {Object} dataPayload - Key-value pair collection containing the data to inject.
   * @param {HTMLElement} containerCtx - The wrapper element containing the compiled form fields.
   */
  autofill(schema, dataPayload, containerCtx = document, { debug = false } = {}) {
    if (!Array.isArray(schema) || !dataPayload) {
      console.warn("QuickForm Engine: Invalid schema matrix or payload profile provided.");
      return;
    }

    if (debug) console.groupCollapsed("⚡ QuickForm Engine: Executing Autofill Operation");

    schema.forEach((field) => {
      try {
        const valueToInject = dataPayload[field.id] !== undefined ? dataPayload[field.id] : dataPayload[field.label];
        if (valueToInject === undefined) return;

        // Radio groups never resolve to a single element via the selector below
        // (multiple inputs share the same `name`), so handle them up front —
        // previously this branch was unreachable because querySelector() still
        // matches the *first* radio in the group, so the code fell through to
        // the generic switch and hit the "unrecognized type" default instead.
        if (field.type === 'radio') {
          const safeId = escapeCss(field.id);
          const radios = Array.from(containerCtx.querySelectorAll(`input[type="radio"][name="${safeId}"]`));
          if (radios.length === 0) {
            if (debug) console.warn(`QuickForm Engine: No radio inputs found for field "${field.id}"`);
            return;
          }
          radios.forEach((radio) => {
            radio.checked = (radio.value === String(valueToInject));
            radio.dispatchEvent(new Event('change', { bubbles: true }));
          });
          if (debug) console.log(`Filled [RADIO]: ${field.id} -> "${valueToInject}"`);
          return;
        }

        // Find the compiled input row by matching your custom structured field ID
        const safeId = escapeCss(field.id);
        const inputSelector = `[name="${safeId}"], #field-input-${safeId}`;
        const element = $(inputSelector, containerCtx);
        if (!element) {
          if (debug) console.warn(`QuickForm Engine: No element found for field "${field.id}"`);
          return;
        }

        switch (field.type) {
          case 'text':
          case 'number':
          case 'select':
          case 'textarea':
            element.value = valueToInject;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            break;

          case 'checkbox':
            element.checked = Boolean(valueToInject);
            element.dispatchEvent(new Event('change', { bubbles: true }));
            break;

          default:
            console.warn(`QuickForm Engine: Unrecognized or unsupported field type [${field.type}] for element ${field.id}`);
            return; // don't log a false "Filled" success below for a type we didn't actually handle

        }

        if (debug) console.log(`Filled [${field.type.toUpperCase()}]: ${field.id} ->`, valueToInject);
      } catch (err) {
        // A single malformed field (bad id, missing DOM node, etc.) should
        // never abort the whole batch — log it and keep filling the rest.
        console.warn(`QuickForm Engine: Failed to fill field "${field?.id}":`, err);
      }
    });

    if (debug) console.groupEnd();
  },

  /**
   * Generates localized smart-mock data structures directly from your form builder schema.
   * Perfect for testing campus database workflows or instant QA evaluation cycles.
   */
  generateMockProfile(schema) {
    const mockData = {};
    schema.forEach(field => {
      const label = field.label || '';
      switch (field.type) {
        case 'text':
        case 'textarea':
          mockData[field.id] = label.includes('Name') ? 'Musa Mustapha' : 'Sample Form Data String';
          break;
        case 'number':
          mockData[field.id] = label.includes('Age') ? 21 : 100;
          break;
        case 'select':
        case 'radio':
          mockData[field.id] = Array.isArray(field.options) && field.options.length > 0 ? field.options[0] : '';
          break;
        case 'checkbox':
          mockData[field.id] = true;
          break;
        default:
          console.warn(`QuickForm Engine: No mock generator for field type [${field.type}] (field "${field.id}")`);
      }
    });
    return mockData;
  }
};