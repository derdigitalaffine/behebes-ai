import React, { useState, useCallback } from 'react';
import { WorkflowDefinition, WorkflowStep, ExecutionMode, StepType } from '../types/workflow';
import WorkflowPlannerStep from './workflow/WorkflowPlannerStep';
import WorkflowStepReview from './workflow/WorkflowStepReview';
import WorkflowExecutor from './workflow/WorkflowExecutor';
import { Alert, ActionButton } from './FormComponents';
import { useI18n } from '../i18n/I18nProvider';
import './Workflow.css';

type WorkflowPhase = 'planning' | 'review' | 'execution';

interface WorkflowProps {
  submissionId?: string;
  onComplete?: (workflow: WorkflowDefinition) => void;
  onCancel?: () => void;
  initialSteps?: WorkflowStep[];
}

const Workflow: React.FC<WorkflowProps> = ({
  submissionId,
  onComplete,
  onCancel,
  initialSteps = [],
}) => {
  const { t } = useI18n();
  const [phase, setPhase] = useState<WorkflowPhase>('planning');
  const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('MANUAL');
  const [title, setTitle] = useState(t('workflow_new_title'));
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Add a new step to the workflow
  const addStep = useCallback((step: WorkflowStep) => {
    setSteps((prev) => [...prev, step]);
    setError('');
  }, []);

  // Update an existing step
  const updateStep = useCallback((stepId: string, updates: Partial<WorkflowStep>) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.id === stepId ? { ...step, ...updates } : step
      )
    );
    setError('');
  }, []);

  // Remove a step
  const removeStep = useCallback((stepId: string) => {
    setSteps((prev) => prev.filter((step) => step.id !== stepId));
  }, []);

  // Move to review phase
  const handleStartReview = () => {
    if (steps.length === 0) {
      setError(t('workflow_error_add_step'));
      return;
    }
    if (!title.trim()) {
      setError(t('workflow_error_title_required'));
      return;
    }
    setError('');
    setPhase('review');
  };

  // Start workflow execution
  const handleStartExecution = () => {
    if (steps.length === 0) {
      setError(t('workflow_error_no_steps'));
      return;
    }
    setError('');
    setPhase('execution');
    setCurrentStepIndex(0);
  };

  // Go back to planning from review
  const handleBackToPlan = () => {
    setPhase('planning');
    setError('');
  };

  // Go back to planning from execution
  const handleBackToPlanFromExecution = () => {
    setPhase('planning');
    setCurrentStepIndex(0);
    setError('');
  };

  // Complete workflow
  const handleWorkflowComplete = (finalWorkflow: WorkflowDefinition) => {
    if (onComplete) {
      onComplete(finalWorkflow);
    }
  };

  return (
    <div className="workflow-container">
      {error && (
        <Alert
          type="error"
          message={error}
          dismissible={true}
          onDismiss={() => setError('')}
        />
      )}

      {/* PHASE 1: PLANNING */}
      {phase === 'planning' && (
        <div className="workflow-phase workflow-planning">
          <h2 className="workflow-title"><i className="fa-solid fa-clipboard-list" /> {t('workflow_plan_title')}</h2>

          {/* Workflow Metadata */}
          <div className="workflow-metadata">
            <div className="metadata-group">
              <label htmlFor="title" className="metadata-label">
                {t('workflow_label_title')}
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="metadata-input"
                placeholder={t('workflow_placeholder_title')}
              />
            </div>

            <div className="metadata-group">
              <label htmlFor="description" className="metadata-label">
                {t('workflow_label_description')}
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="metadata-textarea"
                placeholder={t('workflow_placeholder_description')}
                rows={3}
              />
            </div>

            <div className="metadata-group">
              <label className="metadata-label">{t('workflow_label_execution_mode')}</label>
              <div className="execution-mode-selector">
                <label className="mode-option">
                  <input
                    type="radio"
                    value="MANUAL"
                    checked={executionMode === 'MANUAL'}
                    onChange={(e) => setExecutionMode(e.target.value as ExecutionMode)}
                  />
                  <span className="mode-label">
                    <i className="fa-solid fa-user" /> {t('workflow_mode_manual')}
                    <small>{t('workflow_mode_manual_hint')}</small>
                  </span>
                </label>

                <label className="mode-option">
                  <input
                    type="radio"
                    value="HYBRID"
                    checked={executionMode === 'HYBRID'}
                    onChange={(e) => setExecutionMode(e.target.value as ExecutionMode)}
                  />
                  <span className="mode-label">
                    <i className="fa-solid fa-arrows-rotate" /> {t('workflow_mode_hybrid')}
                    <small>{t('workflow_mode_hybrid_hint')}</small>
                  </span>
                </label>

                <label className="mode-option">
                  <input
                    type="radio"
                    value="AUTO"
                    checked={executionMode === 'AUTO'}
                    onChange={(e) => setExecutionMode(e.target.value as ExecutionMode)}
                  />
                  <span className="mode-label">
                    <i className="fa-solid fa-rocket" /> {t('workflow_mode_auto')}
                    <small>{t('workflow_mode_auto_hint')}</small>
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Steps List */}
          <div className="workflow-steps">
            <h3 className="steps-title">
              {t('workflow_steps_title', { count: steps.length })}
            </h3>

            {steps.length === 0 ? (
              <div className="empty-steps">
                <p>{t('workflow_steps_empty_title')}</p>
                <small>{t('workflow_steps_empty_hint')}</small>
              </div>
            ) : (
              <div className="steps-list">
                {steps.map((step, index) => (
                  <div key={step.id} className="step-item">
                    <div className="step-header">
                      <span className="step-number">{index + 1}</span>
                      <div className="step-info">
                        <h4 className="step-title">{step.title}</h4>
                        <p className="step-type">
                          {step.type === 'REDMINE_TICKET' && (
                            <>
                              <i className="fa-solid fa-thumbtack" /> {t('workflow_step_type_redmine')}
                            </>
                          )}
                          {step.type === 'EMAIL' && (
                            <>
                              <i className="fa-solid fa-envelope" /> {t('workflow_step_type_email')}
                            </>
                          )}
                          {step.type === 'CUSTOM' && t('workflow_step_type_custom')}
                        </p>
                      </div>
                    </div>
                    <div className="step-actions">
                      <button
                        className="step-btn edit-btn"
                        onClick={() => {
                          // TODO: Edit step
                        }}
                        title={t('workflow_step_edit')}
                      >
                        <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                      </button>
                      <button
                        className="step-btn delete-btn"
                        onClick={() => removeStep(step.id)}
                        title={t('workflow_step_delete')}
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Step Section */}
            <WorkflowPlannerStep
              onAddStep={addStep}
              currentStepCount={steps.length}
            />
          </div>

          {/* Action Buttons */}
          <div className="workflow-actions">
            <ActionButton
              variant="secondary"
              onClick={onCancel}
            >
              <i className="fa-solid fa-arrow-left" /> {t('workflow_action_cancel')}
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={handleStartReview}
              disabled={steps.length === 0}
            >
              <i className="fa-solid fa-arrow-right" /> {t('workflow_action_review')}
            </ActionButton>
          </div>
        </div>
      )}

      {/* PHASE 2: REVIEW */}
      {phase === 'review' && (
        <div className="workflow-phase workflow-review">
          <h2 className="workflow-title"><i className="fa-solid fa-check" /> {t('workflow_review_title')}</h2>

          <div className="review-summary">
            <div className="summary-card">
              <h3><i className="fa-solid fa-clipboard-list" /> {title}</h3>
              <p className="summary-description">{description || t('workflow_review_no_description')}</p>
              <p className="summary-mode">
                {t('workflow_review_mode_label')}{' '}
                <strong>
                  {executionMode === 'MANUAL' && <><i className="fa-solid fa-user" /> {t('workflow_mode_manual')}</>}
                  {executionMode === 'HYBRID' && <><i className="fa-solid fa-arrows-rotate" /> {t('workflow_mode_hybrid')}</>}
                  {executionMode === 'AUTO' && <><i className="fa-solid fa-rocket" /> {t('workflow_mode_auto')}</>}
                </strong>
              </p>
              <p className="summary-steps">
                <strong>{steps.length}</strong> {t('workflow_review_steps_label')}
              </p>
            </div>
          </div>

          {/* Review Steps */}
          <div className="review-steps">
            <h3>{t('workflow_review_steps_title')}</h3>
            {steps.map((step, index) => (
              <WorkflowStepReview
                key={step.id}
                step={step}
                stepNumber={index + 1}
                onEdit={(updates) => updateStep(step.id, updates)}
              />
            ))}
          </div>

          {/* Action Buttons */}
          <div className="workflow-actions">
            <ActionButton
              variant="secondary"
              onClick={handleBackToPlan}
            >
              <i className="fa-solid fa-arrow-left" /> {t('workflow_action_back_plan')}
            </ActionButton>
            <ActionButton
              variant="success"
              onClick={handleStartExecution}
            >
              <i className="fa-solid fa-arrow-right" /> {t('workflow_action_start')}
            </ActionButton>
          </div>
        </div>
      )}

      {/* PHASE 3: EXECUTION */}
      {phase === 'execution' && (
        <WorkflowExecutor
          steps={steps}
          executionMode={executionMode}
          workflowTitle={title}
          submissionId={submissionId}
          onBack={handleBackToPlanFromExecution}
          onComplete={handleWorkflowComplete}
        />
      )}
    </div>
  );
};

export default Workflow;
