import { useState, useCallback, useRef } from 'react';

interface ImportDataProps {
  /** Base URL of the FHIR server */
  fhirBaseUrl: string;
  /** Callback when import completes successfully */
  onImportComplete?: () => void;
  /** Additional CSS classes */
  className?: string;
}

interface ImportResult {
  success: boolean;
  imported: {
    schedules: number;
    slots: number;
    appointments: number;
  };
  errors?: string[];
}

/**
 * Component for importing scheduling data from JSON files
 */
export function ImportData({ fhirBaseUrl, onImportComplete, className = '' }: ImportDataProps) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearExisting, setClearExisting] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = useCallback(async (data: any) => {
    setImporting(true);
    setResult(null);
    setError(null);

    try {
      // Add clearExisting flag
      const payload = { ...data, clearExisting };

      const res = await fetch(`${fhirBaseUrl}/Import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errorData.error || 'Import failed');
      }

      const importResult: ImportResult = await res.json();
      setResult(importResult);

      if (importResult.success && onImportComplete) {
        onImportComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [fhirBaseUrl, clearExisting, onImportComplete]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await handleImport(data);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON file. Please check the file format.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to read file');
      }
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleImport]);

  const handlePasteSubmit = useCallback(async () => {
    if (!jsonInput.trim()) {
      setError('Please enter JSON data');
      return;
    }

    try {
      const data = JSON.parse(jsonInput);
      await handleImport(data);
      setJsonInput('');
      setShowPaste(false);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON. Please check the format.');
      } else {
        setError(err instanceof Error ? err.message : 'Import failed');
      }
    }
  }, [jsonInput, handleImport]);

  const downloadTemplate = useCallback(async () => {
    try {
      const res = await fetch(`${fhirBaseUrl}/Import/template`);
      if (!res.ok) throw new Error('Failed to fetch template');
      
      const template = await res.json();
      const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fhirtogether-import-template.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download template');
    }
  }, [fhirBaseUrl]);

  const totalImported = result 
    ? result.imported.schedules + result.imported.slots + result.imported.appointments 
    : 0;

  return (
    <div className={`fs-import-data ${className}`}>
      <header className="fs-import-header">
        <h2 className="fs-section-title">Import Scheduling Data</h2>
        <p className="fs-import-description">
          Import schedules, slots, and appointments from a JSON file.
        </p>
      </header>

      {/* Clear existing data option */}
      <div className="fs-import-option">
        <label className="fs-checkbox-label">
          <input
            type="checkbox"
            checked={clearExisting}
            onChange={(e) => setClearExisting(e.target.checked)}
            className="fs-checkbox"
          />
          <span className="fs-checkbox-text">Clear existing data before import</span>
        </label>
      </div>

      {/* Import actions */}
      <div className="fs-import-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileSelect}
          className="fs-file-input"
          id="import-file-input"
          aria-label="Select JSON file to import"
        />
        <label htmlFor="import-file-input" className="fs-import-btn fs-import-btn-primary">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="fs-import-icon">
            <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" fill="currentColor" />
          </svg>
          Upload JSON File
        </label>

        <button
          type="button"
          className="fs-import-btn fs-import-btn-secondary"
          onClick={() => setShowPaste(!showPaste)}
          aria-expanded={showPaste}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="fs-import-icon">
            <path d="M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z" fill="currentColor" />
          </svg>
          Paste JSON
        </button>

        <button
          type="button"
          className="fs-import-btn fs-import-btn-secondary"
          onClick={downloadTemplate}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="fs-import-icon">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor" />
          </svg>
          Download Template
        </button>
      </div>

      {/* Paste JSON textarea */}
      {showPaste && (
        <div className="fs-import-paste">
          <label htmlFor="json-paste" className="fs-import-paste-label">
            Paste JSON data:
          </label>
          <textarea
            id="json-paste"
            className="fs-import-textarea"
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder='{"schedules": [...], "slots": [...], "appointments": [...]}'
            rows={10}
          />
          <div className="fs-import-paste-actions">
            <button
              type="button"
              className="fs-import-btn fs-import-btn-primary"
              onClick={handlePasteSubmit}
              disabled={importing || !jsonInput.trim()}
            >
              Import Pasted Data
            </button>
            <button
              type="button"
              className="fs-import-btn fs-import-btn-secondary"
              onClick={() => {
                setShowPaste(false);
                setJsonInput('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {importing && (
        <div className="fs-import-loading" role="status" aria-live="polite">
          <div className="fs-loading-spinner">
            <svg className="fs-spinner" viewBox="0 0 50 50" aria-label="Importing data">
              <circle className="fs-spinner-track" cx="25" cy="25" r="20" fill="none" strokeWidth="4" />
              <circle className="fs-spinner-head" cx="25" cy="25" r="20" fill="none" strokeWidth="4" strokeDasharray="80, 200" strokeLinecap="round" />
            </svg>
            <span className="fs-loading-text">Importing data...</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !importing && (
        <div className="fs-import-error" role="alert">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="fs-import-error-icon">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor" />
          </svg>
          <span>{error}</span>
          <button
            type="button"
            className="fs-import-error-dismiss"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Success result */}
      {result && !importing && (
        <div 
          className={`fs-import-result ${result.success ? 'fs-import-result-success' : 'fs-import-result-warning'}`}
          role="status" 
          aria-live="polite"
        >
          <div className="fs-import-result-header">
            {result.success ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" className="fs-import-result-icon fs-import-result-icon-success">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" className="fs-import-result-icon fs-import-result-icon-warning">
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor" />
              </svg>
            )}
            <span className="fs-import-result-title">
              {result.success 
                ? `Successfully imported ${totalImported} ${totalImported === 1 ? 'resource' : 'resources'}`
                : 'Import completed with errors'}
            </span>
          </div>

          <div className="fs-import-result-details">
            <span className="fs-import-result-item">
              <strong>{result.imported.schedules}</strong> schedules
            </span>
            <span className="fs-import-result-item">
              <strong>{result.imported.slots}</strong> slots
            </span>
            <span className="fs-import-result-item">
              <strong>{result.imported.appointments}</strong> appointments
            </span>
          </div>

          {result.errors && result.errors.length > 0 && (
            <details className="fs-import-errors-details">
              <summary className="fs-import-errors-summary">
                {result.errors.length} {result.errors.length === 1 ? 'error' : 'errors'}
              </summary>
              <ul className="fs-import-errors-list">
                {result.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </details>
          )}

          <button
            type="button"
            className="fs-import-result-dismiss"
            onClick={() => setResult(null)}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
