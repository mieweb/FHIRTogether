import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { SchedulerWidget } from './components/SchedulerWidget';
import type { Appointment, FormsRendererFormData } from './types';
import schedulerStyles from './styles/scheduler.css?inline';

/**
 * FHIR Scheduler Web Component
 * 
 * Usage:
 * ```html
 * <fhir-scheduler
 *   fhir-base-url="https://api.example.com/fhir"
 *   hold-duration="10"
 * ></fhir-scheduler>
 * ```
 */
class FhirSchedulerElement extends HTMLElement {
  private root: Root | null = null;
  private _questionnaireFormData: FormsRendererFormData | undefined = undefined;
  
  static get observedAttributes() {
    return ['fhir-base-url', 'provider-id', 'hold-duration'];
  }
  
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }
  
  connectedCallback() {
    this.render();
  }
  
  disconnectedCallback() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
  
  attributeChangedCallback() {
    this.render();
  }
  
  get questionnaireFormData(): FormsRendererFormData | undefined {
    return this._questionnaireFormData;
  }
  
  set questionnaireFormData(value: FormsRendererFormData | undefined) {
    this._questionnaireFormData = value;
    this.render();
  }
  
  private render() {
    if (!this.shadowRoot) return;
    
    const fhirBaseUrl = this.getAttribute('fhir-base-url');
    if (!fhirBaseUrl) {
      this.shadowRoot.innerHTML = '<p style="color: red;">Error: fhir-base-url attribute is required</p>';
      return;
    }
    
    const providerId = this.getAttribute('provider-id') || undefined;
    const holdDuration = parseInt(this.getAttribute('hold-duration') || '5', 10);
    
    // Create container and inject styles
    if (!this.shadowRoot.querySelector('#fhir-scheduler-container')) {
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          ${schedulerStyles}
        </style>
        <div id="fhir-scheduler-container"></div>
      `;
    }
    
    const container = this.shadowRoot.querySelector('#fhir-scheduler-container');
    if (!container) return;
    
    if (!this.root) {
      this.root = createRoot(container);
    }
    
    const handleComplete = (appointment: Appointment) => {
      this.dispatchEvent(
        new CustomEvent('complete', {
          detail: appointment,
          bubbles: true,
          composed: true,
        })
      );
    };
    
    const handleError = (error: Error) => {
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: error,
          bubbles: true,
          composed: true,
        })
      );
    };
    
    this.root.render(
      React.createElement(SchedulerWidget, {
        fhirBaseUrl,
        providerId,
        questionnaireFormData: this._questionnaireFormData,
        holdDurationMinutes: holdDuration,
        onComplete: handleComplete,
        onError: handleError,
      })
    );
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('fhir-scheduler')) {
  customElements.define('fhir-scheduler', FhirSchedulerElement);
}

export { FhirSchedulerElement };
