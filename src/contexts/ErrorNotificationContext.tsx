import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

export interface ErrorNotification {
  id: number;
  message: string;
  type: 'error' | 'warning' | 'info';
}

interface ErrorNotificationContextType {
  errors: ErrorNotification[];
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
  dismissError: (id: number) => void;
  clearAll: () => void;
}

const ErrorNotificationContext = createContext<ErrorNotificationContextType | undefined>(undefined);

interface ErrorNotificationProviderProps {
  children: ReactNode;
  autoDismissMs?: number;
}

export function ErrorNotificationProvider({
  children,
  autoDismissMs = 5000
}: ErrorNotificationProviderProps) {
  const [errors, setErrors] = useState<ErrorNotification[]>([]);
  const errorIdRef = useRef(0);

  const addNotification = useCallback((message: string, type: 'error' | 'warning' | 'info') => {
    const id = ++errorIdRef.current;
    setErrors(prev => [...prev, { id, message, type }]);

    // Auto-dismiss after specified time
    if (autoDismissMs > 0) {
      setTimeout(() => {
        setErrors(prev => prev.filter(e => e.id !== id));
      }, autoDismissMs);
    }
  }, [autoDismissMs]);

  const showError = useCallback((message: string) => addNotification(message, 'error'), [addNotification]);
  const showWarning = useCallback((message: string) => addNotification(message, 'warning'), [addNotification]);
  const showInfo = useCallback((message: string) => addNotification(message, 'info'), [addNotification]);

  const dismissError = useCallback((id: number) => {
    setErrors(prev => prev.filter(e => e.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setErrors([]);
  }, []);

  return (
    <ErrorNotificationContext.Provider value={{ errors, showError, showWarning, showInfo, dismissError, clearAll }}>
      {children}
    </ErrorNotificationContext.Provider>
  );
}

export function useErrorNotification(): ErrorNotificationContextType {
  const context = useContext(ErrorNotificationContext);
  if (!context) {
    throw new Error('useErrorNotification must be used within an ErrorNotificationProvider');
  }
  return context;
}

// Component to render error notifications
export function ErrorNotifications() {
  const { errors, dismissError } = useErrorNotification();

  if (errors.length === 0) return null;

  return (
    <div className="error-notifications" role="alert" aria-live="assertive">
      {errors.map((error) => (
        <div
          key={error.id}
          className={`error-notification ${error.type}`}
        >
          <span className="error-icon">
            {error.type === 'error' ? '⚠️' : error.type === 'warning' ? '⚡' : 'ℹ️'}
          </span>
          <span className="error-message">{error.message}</span>
          <button
            className="error-dismiss"
            onClick={() => dismissError(error.id)}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
