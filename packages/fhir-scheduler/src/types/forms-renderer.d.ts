/**
 * Type declarations for @mieweb/forms-renderer
 * @see https://github.com/mieweb/questionnaire-builder/
 */
declare module '@mieweb/forms-renderer' {
  import React from 'react';

  /** Field option - supports both label and value formats */
  interface FormFieldOption {
    id?: string;
    value: string;
    label?: string;
  }

  /** Field from the forms-engine */
  interface FormField {
    id: string;
    fieldType: string;
    title?: string;
    question?: string;
    description?: string;
    options?: FormFieldOption[];
    answer?: unknown;
    selected?: unknown;
    fields?: FormField[];
    enableWhen?: Array<{
      question: string;
      operator: string;
      answer: unknown;
    }> | {
      logic: 'AND' | 'OR';
      conditions: Array<{
        targetId: string;
        operator: string;
        value: unknown;
      }>;
    };
    [key: string]: unknown;
  }

  /** Form data schema */
  interface FormData {
    schemaType?: string;
    title?: string;
    description?: string;
    fields: FormField[];
  }

  /** Props for QuestionnaireRenderer component */
  interface QuestionnaireRendererProps {
    formData: FormData;
    onChange?: (formData: FormData) => void;
    hideUnsupportedFields?: boolean;
    className?: string;
    storeRef?: React.MutableRefObject<unknown>;
  }

  /** QuestionnaireRenderer React component */
  export const QuestionnaireRenderer: React.FC<QuestionnaireRendererProps>;

  /**
   * Build a FHIR QuestionnaireResponse from form fields
   * @param fields - Array of form fields with answers
   * @param questionnaireId - ID of the source questionnaire
   * @param subjectId - Optional subject reference
   * @returns FHIR QuestionnaireResponse resource
   */
  export function buildQuestionnaireResponse(
    fields: FormField[],
    questionnaireId: string,
    subjectId?: string
  ): unknown;

  /**
   * Hook to access fields array from form store
   */
  export function useFieldsArray(): FormField[];

  // Re-export types for external use
  export type { FormData, FormField, QuestionnaireRendererProps };
}
