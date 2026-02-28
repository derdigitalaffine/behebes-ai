import React, { useState, useEffect } from 'react';
import { WorkflowStep, WorkflowDefinition, ExecutionMode } from '../../types/workflow';
import { LoadingSpinner, Alert, ActionButton, ProgressBar } from '../FormComponents';
import { useI18n } from '../../i18n/I18nProvider';
import './WorkflowExecutor.css';

interface WorkflowExecutorProps {
  steps: WorkflowStep[];
  executionMode: ExecutionMode;
  workflowTitle: string;
  submissionId?: string;
  onBack?: () => void;
  onComplete?: (workflow: WorkflowDefinition) => void;
}

const WorkflowExecutor: React.FC<WorkflowExecutorProps> = ({
  steps,
  executionMode,
  workflowTitle,
  submissionId,
  onBack,
  onComplete,
}) => {
  const { t } = useI18n();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [executingSteps, setExecutingSteps] = useState<WorkflowStep[]>(
    steps.map((step) => ({ ...step, status: 'PENDING' as const }))
  );
  const [isExecuting, setIsExecuting] = useState(executionMode === 'AUTO');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const currentStep = executingSteps[currentStepIndex];
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  // Auto-execute if mode is AUTO
  useEffect(() => {
    if (executionMode === 'AUTO' && isExecuting) {
      const timer = setTimeout(() => {
        handleExecuteStep();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isExecuting, currentStepIndex, executionMode]);

  const handleExecuteStep = async () => {
    if (!currentStep) return;

    setError('');
    setSuccess('');
    setIsExecuting(true);

    try {
      // Update step status
      setExecutingSteps((prev) =>
        prev.map((s, i) =>
          i === currentStepIndex ? { ...s, status: 'RUNNING' } : s
        )
      );

      // Simulate step execution
      await executeStepLogic(currentStep);

      // Mark as complete
      setExecutingSteps((prev) =>
        prev.map((s, i) =>
          i === currentStepIndex
            ? {
                ...s,
                status: 'COMPLETED',
                executionData: {
                  ...s.executionData,
                  startedAt: new Date().toISOString(),
                  completedAt: new Date().toISOString(),
                  result: t('workflow_executor_step_result'),
                },
              }
            : s
        )
      );

      setSuccess(t('workflow_executor_step_done', { title: currentStep.title }));

      // Move to next step or finish
      if (currentStepIndex < executingSteps.length - 1) {
        setTimeout(() => {
          setCurrentStepIndex((prev) => prev + 1);
          if (executionMode === 'AUTO') {
            // Auto mode continues automatically
          } else if (executionMode === 'HYBRID') {
            // Hybrid mode pauses after each step
            setIsExecuting(false);
          }
        }, 1000);
      } else {
        // All done
        setIsExecuting(false);
        handleComplete();
      }
    } catch (err: any) {
      setError(err.message || t('workflow_executor_error'));
      setExecutingSteps((prev) =>
        prev.map((s, i) =>
          i === currentStepIndex
            ? {
                ...s,
                status: 'FAILED',
                executionData: {
                  ...s.executionData,
                  error: err.message,
                },
              }
            : s
        )
      );
      setIsExecuting(false);
    }
  };

  const executeStepLogic = async (step: WorkflowStep): Promise<void> => {
    // Simulate API calls for different step types
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (step.type === 'REDMINE_TICKET') {
          // In real scenario: Call Redmine API
          console.log('Creating Redmine ticket:', step.config);
          resolve();
        } else if (step.type === 'EMAIL') {
          // In real scenario: Call email service
          console.log('Sending email:', step.config);
          resolve();
        } else if (step.type === 'CUSTOM') {
          console.log('Executing custom step:', step.config);
          resolve();
        }
      }, 1500);
    });
  };

  const handleSkipStep = () => {
    setExecutingSteps((prev) =>
      prev.map((s, i) =>
        i === currentStepIndex ? { ...s, status: 'SKIPPED' } : s
      )
    );

    if (currentStepIndex < executingSteps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      handleComplete();
    }
    setError('');
  };

  const handleComplete = () => {
    if (onComplete) {
      const workflow: WorkflowDefinition = {
        id: `workflow-${Date.now()}`,
        title: workflowTitle,
        description: '',
        submissionId,
        steps: executingSteps,
        executionMode,
        status: executingSteps.some((s) => s.status === 'FAILED') ? 'FAILED' : 'COMPLETED',
        currentStepIndex: executingSteps.length - 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onComplete(workflow);
    }
  };

  const allComplete = executingSteps.every(
    (s) => s.status === 'COMPLETED' || s.status === 'SKIPPED'
  );

  return (
    <div className="workflow-executor">
      <h2 className="executor-title"><i className="fa-solid fa-rocket" /> {t('workflow_executor_title')}</h2>

      {/* Progress Bar */}
      <div className="executor-progress">
        <ProgressBar current={currentStepIndex + 1} total={steps.length} />
      </div>

      {/* Status Messages */}
      {error && (
        <Alert
          type="error"
          message={error}
          dismissible={true}
          onDismiss={() => setError('')}
        />
      )}

      {success && (
        <Alert
          type="success"
          message={success}
          dismissible={true}
          onDismiss={() => setSuccess('')}
        />
      )}

      {/* Current Step Execution */}
      {!allComplete && currentStep && (
        <div className="executor-current">
          <div className="current-step-card">
            <h3 className="current-step-title">
              {currentStep.status === 'RUNNING' ? (
                <i className="fa-solid fa-hourglass-half" />
              ) : (
                <i className="fa-solid fa-clipboard-list" />
              )}{' '}
              {currentStep.title}
            </h3>
            <p className="current-step-desc">{currentStep.description}</p>

            {currentStep.status === 'RUNNING' && (
              <div className="running-indicator">
                <LoadingSpinner text={t('workflow_executor_running')} size="small" />
              </div>
            )}

            {currentStep.status === 'FAILED' && currentStep.executionData?.error && (
              <div className="error-display">
                <p className="error-text"><i className="fa-solid fa-circle-xmark" /> {currentStep.executionData.error}</p>
              </div>
            )}

            {currentStep.status === 'COMPLETED' && currentStep.executionData?.result && (
              <div className="success-display">
                <p className="success-text"><i className="fa-solid fa-check" /> {currentStep.executionData.result}</p>
              </div>
            )}

            {/* Action Buttons */}
            {currentStep.status === 'PENDING' && (
              <div className="executor-actions">
                {executionMode === 'MANUAL' && (
                  <>
                    <ActionButton
                      variant="secondary"
                      onClick={handleSkipStep}
                    >
                      <i className="fa-solid fa-ban" /> {t('workflow_executor_skip')}
                    </ActionButton>
                    <ActionButton
                      variant="success"
                      onClick={handleExecuteStep}
                      loading={isExecuting}
                    >
                      <i className="fa-solid fa-play" /> {t('workflow_executor_run')}
                    </ActionButton>
                  </>
                )}

                {executionMode === 'HYBRID' && (
                  <>
                    <ActionButton
                      variant="secondary"
                      onClick={handleSkipStep}
                    >
                      <i className="fa-solid fa-ban" /> {t('workflow_executor_skip')}
                    </ActionButton>
                    <ActionButton
                      variant="success"
                      onClick={handleExecuteStep}
                      loading={isExecuting}
                    >
                      <i className="fa-solid fa-play" /> {t('workflow_executor_run')}
                    </ActionButton>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Steps Overview */}
      <div className="executor-steps-list">
        <h4 className="steps-list-title">{t('workflow_executor_steps_title')}</h4>
        <div className="steps-overview">
          {executingSteps.map((step, index) => (
            <div
              key={step.id}
              className={`step-overview-item step-${step.status}`}
            >
              <div className="step-index">{index + 1}</div>
              <div className="step-overview-content">
                <p className="step-overview-title">{step.title}</p>
                <p className="step-overview-status">
                  {step.status === 'PENDING' && <><i className="fa-solid fa-hourglass-half" /> {t('workflow_executor_status_pending')}</>}
                  {step.status === 'RUNNING' && <><i className="fa-solid fa-spinner fa-spin" /> {t('workflow_executor_status_running')}</>}
                  {step.status === 'COMPLETED' && <><i className="fa-solid fa-check" /> {t('workflow_executor_status_done')}</>}
                  {step.status === 'FAILED' && <><i className="fa-solid fa-circle-xmark" /> {t('workflow_executor_status_failed')}</>}
                  {step.status === 'SKIPPED' && <><i className="fa-solid fa-ban" /> {t('workflow_executor_status_skipped')}</>}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Completion Screen */}
      {allComplete && (
        <div className="executor-complete">
          <div className="complete-card">
            <div className="complete-icon"><i className="fa-solid fa-check" /></div>
            <h3 className="complete-title">{t('workflow_executor_complete_title')}</h3>
            <p className="complete-message">
              {executingSteps.filter((s) => s.status === 'FAILED').length > 0
                ? t('workflow_executor_complete_partial')
                : t('workflow_executor_complete_success')}
            </p>

            <div className="complete-summary">
              <div className="summary-stat">
                <span className="stat-label">{t('workflow_executor_summary_done')}</span>
                <span className="stat-value">
                  {executingSteps.filter((s) => s.status === 'COMPLETED').length}/{steps.length}
                </span>
              </div>
              {executingSteps.filter((s) => s.status === 'SKIPPED').length > 0 && (
                <div className="summary-stat">
                  <span className="stat-label">{t('workflow_executor_summary_skipped')}</span>
                  <span className="stat-value">
                    {executingSteps.filter((s) => s.status === 'SKIPPED').length}
                  </span>
                </div>
              )}
              {executingSteps.filter((s) => s.status === 'FAILED').length > 0 && (
                <div className="summary-stat">
                  <span className="stat-label">{t('workflow_executor_summary_failed')}</span>
                  <span className="stat-value error">
                    {executingSteps.filter((s) => s.status === 'FAILED').length}
                  </span>
                </div>
              )}
            </div>

            <div className="executor-final-actions">
              {onBack && (
                <ActionButton
                  variant="secondary"
                  onClick={onBack}
                >
                  <i className="fa-solid fa-arrow-left" /> {t('workflow_action_back')}
                </ActionButton>
              )}
              <ActionButton
                variant="success"
                onClick={handleComplete}
              >
                <i className="fa-solid fa-check" /> {t('workflow_executor_finish')}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowExecutor;
