import { useState, useCallback, useRef } from 'react';
import { useSchedulerStore } from '../store/schedulerStore';
import { QuestionnaireRenderer, buildQuestionnaireResponse } from '@mieweb/forms-renderer';
import type { FormData as QuestionnaireFormData, FormField } from '@mieweb/forms-renderer';

interface IntakeQuestionnaireProps {
  questionnaireFormData: QuestionnaireFormData;
  onComplete?: () => void;
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
  
  // Check if field is hidden by enableWhen logic
  if (field.visible === false) {
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
 * Check if questionnaire is complete
 */
function isQuestionnaireComplete(fields: Record<string, unknown>[]): boolean {
  return fields.every((field) => isFieldAnswered(field));
}

/**
 * Intake Questionnaire step component
 * Shows the questionnaire before provider selection for new patients
 */
export function IntakeQuestionnaire({ questionnaireFormData, onComplete }: IntakeQuestionnaireProps) {
  const goBack = useSchedulerStore((state) => state.goBack);
  const proceedFromQuestionnaire = useSchedulerStore((state) => state.proceedFromQuestionnaire);
  const setQuestionnaireResponse = useSchedulerStore((state) => state.setQuestionnaireResponse);
  
  const [isComplete, setIsComplete] = useState(false);
  const [showValidationError, setShowValidationError] = useState(false);
  const storeRef = useRef<{ getState: () => { order: string[]; byId: Record<string, FormField> } } | null>(null);
  
  const handleQuestionnaireChange = useCallback((_updatedFormData: unknown) => {
    if (!storeRef.current) return;
    
    try {
      const state = storeRef.current.getState();
      const fields: FormField[] = state.order.map((id: string) => state.byId[id]);
      const response = buildQuestionnaireResponse(fields, 'intake-questionnaire');
      
      setQuestionnaireResponse(response as import('../types').QuestionnaireResponse);
      
      // Check completion status
      const complete = isQuestionnaireComplete(fields as Record<string, unknown>[]);
      setIsComplete(complete);
      if (complete) {
        setShowValidationError(false);
      }
    } catch (err) {
      console.warn('Failed to build questionnaire response:', err);
    }
  }, [setQuestionnaireResponse]);
  
  const handleContinue = () => {
    if (!isComplete) {
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
          onChange={handleQuestionnaireChange}
          hideUnsupportedFields={true}
          className="fs-questionnaire-renderer"
          storeRef={storeRef}
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
