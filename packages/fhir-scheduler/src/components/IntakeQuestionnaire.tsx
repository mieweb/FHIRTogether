import React from 'react';
import { useState, useRef } from 'react';
import { useSchedulerStore } from '../store/schedulerStore';
import { QuestionnaireRenderer, toFhirQuestionnaireResponse } from '@mieweb/forms-renderer';
import type { FormData as QuestionnaireFormData, FormField } from '@mieweb/forms-renderer';

interface IntakeQuestionnaireProps {
  questionnaireFormData: QuestionnaireFormData;
  onComplete?: () => void;
}

type EnableWhenCondition = { targetId: string; operator: string; value: string };
type EnableWhen = { logic?: string; conditions: EnableWhenCondition[] };

/**
 * Evaluate a single enableWhen condition against a map of fields
 */
function evaluateCondition(condition: EnableWhenCondition, fieldsMap: Map<string, Record<string, unknown>>): boolean {
  const targetField = fieldsMap.get(condition.targetId);
  if (!targetField) return true;
  const { operator, value } = condition;
  const selected = targetField.selected;
  switch (operator) {
    case 'equals': return selected === value;
    case 'notEquals': return selected !== value;
    case 'includes': return Array.isArray(selected) ? selected.includes(value) : selected === value;
    case 'notIncludes': return Array.isArray(selected) ? !selected.includes(value) : selected !== value;
    default: return true;
  }
}

/**
 * Check if a field is visible based on its enableWhen conditions
 */
function isFieldVisible(field: Record<string, unknown>, fieldsMap: Map<string, Record<string, unknown>>): boolean {
  const enableWhen = field.enableWhen as EnableWhen | undefined;
  if (!enableWhen || !Array.isArray(enableWhen.conditions) || enableWhen.conditions.length === 0) return true;
  const results = enableWhen.conditions.map((c) => evaluateCondition(c, fieldsMap));
  return ((enableWhen.logic ?? 'AND').toUpperCase() === 'AND') ? results.every(Boolean) : results.some(Boolean);
}

/**
 * Check if a field has been answered
 */
function isFieldAnswered(field: Record<string, unknown>): boolean {
  const fieldType = field.fieldType as string;

  // Skip section headers - they don't need answers
  if (fieldType === 'section') {
    return true;
  }

  switch (fieldType) {
    case 'text':
    case 'longtext':
    case 'multitext':
      return typeof field.answer === 'string' && field.answer.trim().length > 0;
    case 'radio':
    case 'dropdown':
    case 'boolean':
      return field.selected != null && field.selected !== '';
    case 'check':
    case 'multiselect':
      return Array.isArray(field.selected) && field.selected.length > 0;
    default:
      return true;
  }
}

/**
 * Flatten top-level + section children into a single list
 */
function flattenFields(fields: Record<string, unknown>[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const field of fields) {
    result.push(field);
    if (field.fieldType === 'section' && Array.isArray(field.fields)) {
      result.push(...flattenFields(field.fields as Record<string, unknown>[]));
    }
  }
  return result;
}

/**
 * Check if questionnaire is complete — only visible non-section fields need to be answered
 */
function isQuestionnaireComplete(fields: Record<string, unknown>[]): boolean {
  const allFields = flattenFields(fields);
  const fieldsMap = new Map(allFields.map((f) => [f.id as string, f]));
  return allFields
    .filter((field) => field.fieldType !== 'section')
    .filter((field) => isFieldVisible(field, fieldsMap))
    .every((field) => isFieldAnswered(field));
}

/**
 * Intake Questionnaire step component
 * Shows the questionnaire before provider selection for new patients
 */
export function IntakeQuestionnaire({ questionnaireFormData, onComplete }: IntakeQuestionnaireProps) {
  const goBack = useSchedulerStore((state) => state.goBack);
  const proceedFromQuestionnaire = useSchedulerStore((state) => state.proceedFromQuestionnaire);
  const setQuestionnaireResponse = useSchedulerStore((state) => state.setQuestionnaireResponse);

  const [showValidationError, setShowValidationError] = useState(false);
  // QuestionnaireRenderer v2.1.5 exposes getResponse() via ref (returns flat array of answered FHIR items)
  const rendererRef = useRef<{ getResponse: () => Array<{ id: string; answer?: Array<{ id?: string; value?: string }> }> } | null>(null);

  const handleContinue = () => {
    const responseItems = rendererRef.current?.getResponse() ?? null;

    if (!responseItems) {
      // Renderer not ready yet
      setShowValidationError(true);
      return;
    }

    // Build a state map from the FHIR response items so enableWhen conditions can be evaluated
    const allQFields = flattenFields(questionnaireFormData.fields as Record<string, unknown>[]);
    const answeredIds = new Set(responseItems.map((item) => item.id));

    const stateMap = new Map<string, Record<string, unknown>>();
    for (const field of allQFields) {
      const fieldId = field.id as string;
      const responseItem = responseItems.find((item) => item.id === fieldId);
      if (responseItem) {
        const fieldType = field.fieldType as string;
        if (['radio', 'dropdown', 'boolean'].includes(fieldType)) {
          stateMap.set(fieldId, { ...field, selected: responseItem.answer?.[0]?.id ?? null });
        } else if (['check', 'multiselect'].includes(fieldType)) {
          stateMap.set(fieldId, { ...field, selected: (responseItem.answer ?? []).map((a) => a.id).filter(Boolean) });
        } else {
          stateMap.set(fieldId, { ...field, answer: responseItem.answer?.[0]?.value ?? '' });
        }
      } else {
        stateMap.set(fieldId, field);
      }
    }

    // Build FHIR QuestionnaireResponse for the store
    try {
      const response = toFhirQuestionnaireResponse(
        responseItems as unknown as FormField[],
        'intake-questionnaire'
      );
      setQuestionnaireResponse(response as import('../types').QuestionnaireResponse);
    } catch {
      // Non-critical — proceed even if FHIR response can't be built
    }

    // All visible non-section fields must have answers
    const complete = allQFields
      .filter((f) => f.fieldType !== 'section')
      .filter((f) => isFieldVisible(f, stateMap))
      .every((f) => answeredIds.has(f.id as string));

    if (!complete) {
      setShowValidationError(true);
      return;
    }

    proceedFromQuestionnaire();
    onComplete?.();
  };

  return (
    <div className="fs-intake-questionnaire">
      <header className="fs-questionnaire-header">
        <button
          type="button"
          className="fs-back-button"
          onClick={goBack}
          aria-label="Back to visit type selection"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h2 className="fs-questionnaire-title">Patient Intake</h2>
      </header>

      <p className="fs-questionnaire-intro">
        Please complete the following questions to help us better serve you.
        This information will be reviewed by our staff to match you with the right provider.
      </p>

      <div className="fs-questionnaire-form">
        <QuestionnaireRenderer
          formData={questionnaireFormData}
          ref={rendererRef as React.Ref<unknown>}
          hideUnsupportedFields={true}
          className="fs-questionnaire-renderer"
        />
      </div>

      {showValidationError && (
        <div className="fs-error-message" role="alert">
          <svg className="fs-error-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
              fill="currentColor"
            />
          </svg>
          <span>Please complete all questions before continuing</span>
        </div>
      )}

      <div className="fs-questionnaire-actions">
        <button
          type="button"
          className="fs-continue-button"
          onClick={handleContinue}
        >
          Continue to Provider Selection
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Connected version that uses the Zustand store
 */
export function ConnectedIntakeQuestionnaire({
  questionnaireFormData,
}: {
  questionnaireFormData?: QuestionnaireFormData;
}) {
  if (!questionnaireFormData) {
    // If no questionnaire provided, skip to provider selection
    const proceedFromQuestionnaire = useSchedulerStore.getState().proceedFromQuestionnaire;
    proceedFromQuestionnaire();
    return null;
  }

  return <IntakeQuestionnaire questionnaireFormData={questionnaireFormData} />;
}
