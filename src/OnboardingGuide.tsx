import { useState, useEffect, useCallback, useRef } from "react";

interface OnboardingStep {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  position: "top" | "bottom" | "left" | "right";
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "open-folder",
    targetSelector: ".toolbar-btn:first-child",
    title: "Open a Folder",
    description: "Click here or press Cmd+O to select a folder to analyze. You can also drag and drop a folder onto the app.",
    position: "bottom",
  },
  {
    id: "filter-type",
    targetSelector: ".filter-menu",
    title: "Filter by File Type",
    description: "Filter the visualization by file type - documents, images, videos, code, and more.",
    position: "bottom",
  },
  {
    id: "size-filter",
    targetSelector: ".size-filters",
    title: "Quick Size Filters",
    description: "Quickly filter to show only large files (>100MB, >1GB, >10GB) to find space hogs.",
    position: "bottom",
  },
  {
    id: "search",
    targetSelector: ".search-box",
    title: "Search Files",
    description: "Search for files by name. Use Enter to jump between matches, and Cmd+F to focus the search box.",
    position: "bottom",
  },
  {
    id: "theme",
    targetSelector: ".theme-switcher",
    title: "Change Theme",
    description: "Choose from multiple themes including light, dark, and colorful options. Set to 'Auto' to follow system preferences.",
    position: "bottom",
  },
  {
    id: "settings",
    targetSelector: ".settings-btn",
    title: "Settings",
    description: "Configure scanning options, appearance, and more. Open with Cmd+,",
    position: "bottom",
  },
  {
    id: "treemap",
    targetSelector: ".treemap-container",
    title: "Interactive Treemap",
    description: "Double-click folders to navigate into them. Use Cmd+scroll to zoom, Alt+drag to pan. Right-click for more options.",
    position: "top",
  },
];

const STORAGE_KEY = "spaceview-onboarding-completed";

interface OnboardingGuideProps {
  onComplete: () => void;
  forceShow?: boolean;
}

export function OnboardingGuide({ onComplete, forceShow = false }: OnboardingGuideProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Check if onboarding should be shown
  useEffect(() => {
    if (forceShow) {
      setIsVisible(true);
      return;
    }

    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      // Delay showing the guide to let the UI render first
      const timer = setTimeout(() => setIsVisible(true), 500);
      return () => clearTimeout(timer);
    }
  }, [forceShow]);

  // Update position when step changes
  const updatePosition = useCallback(() => {
    if (!isVisible || currentStep >= ONBOARDING_STEPS.length) return;

    const step = ONBOARDING_STEPS[currentStep];
    const targetElement = document.querySelector(step.targetSelector);

    if (!targetElement) {
      // Element not found, skip to next step
      if (currentStep < ONBOARDING_STEPS.length - 1) {
        setCurrentStep((prev) => prev + 1);
      }
      return;
    }

    const rect = targetElement.getBoundingClientRect();
    setHighlightRect(rect);

    // Calculate tooltip position based on step.position
    const tooltipWidth = 320;
    const tooltipHeight = 160;
    const padding = 16;

    let top = 0;
    let left = 0;

    switch (step.position) {
      case "bottom":
        top = rect.bottom + padding;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case "top":
        top = rect.top - tooltipHeight - padding;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.left - tooltipWidth - padding;
        break;
      case "right":
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.right + padding;
        break;
    }

    // Keep tooltip within viewport bounds
    left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - tooltipHeight - padding));

    setTooltipPosition({ top, left });
  }, [isVisible, currentStep]);

  useEffect(() => {
    updatePosition();

    // Update on resize
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [updatePosition]);

  const handleNext = useCallback(() => {
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleComplete();
    }
  }, [currentStep]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const handleComplete = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsVisible(false);
    onComplete();
  }, [onComplete]);

  const handleSkip = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsVisible(false);
    onComplete();
  }, [onComplete]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleSkip();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, handleNext, handlePrev, handleSkip]);

  if (!isVisible || currentStep >= ONBOARDING_STEPS.length) {
    return null;
  }

  const step = ONBOARDING_STEPS[currentStep];

  return (
    <div className="onboarding-overlay">
      {/* Dark overlay with cutout for highlighted element */}
      <svg className="onboarding-mask" width="100%" height="100%">
        <defs>
          <mask id="onboarding-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {highlightRect && (
              <rect
                x={highlightRect.left - 8}
                y={highlightRect.top - 8}
                width={highlightRect.width + 16}
                height={highlightRect.height + 16}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.7)"
          mask="url(#onboarding-mask)"
        />
      </svg>

      {/* Highlight border around target element */}
      {highlightRect && (
        <div
          className="onboarding-highlight"
          style={{
            left: highlightRect.left - 8,
            top: highlightRect.top - 8,
            width: highlightRect.width + 16,
            height: highlightRect.height + 16,
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="onboarding-tooltip"
        style={{
          top: tooltipPosition.top,
          left: tooltipPosition.left,
        }}
      >
        <div className="onboarding-tooltip-header">
          <span className="onboarding-step-indicator">
            {currentStep + 1} / {ONBOARDING_STEPS.length}
          </span>
          <button
            className="onboarding-skip-btn"
            onClick={handleSkip}
            aria-label="Skip onboarding"
          >
            Skip
          </button>
        </div>

        <h3 className="onboarding-tooltip-title">{step.title}</h3>
        <p className="onboarding-tooltip-description">{step.description}</p>

        <div className="onboarding-tooltip-footer">
          <button
            className="onboarding-btn onboarding-btn-secondary"
            onClick={handlePrev}
            disabled={currentStep === 0}
          >
            Previous
          </button>
          <button
            className="onboarding-btn onboarding-btn-primary"
            onClick={handleNext}
          >
            {currentStep === ONBOARDING_STEPS.length - 1 ? "Get Started" : "Next"}
          </button>
        </div>

        {/* Progress dots */}
        <div className="onboarding-progress">
          {ONBOARDING_STEPS.map((_, index) => (
            <button
              key={index}
              className={`onboarding-dot${index === currentStep ? " active" : ""}${index < currentStep ? " completed" : ""}`}
              onClick={() => setCurrentStep(index)}
              aria-label={`Go to step ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Helper to reset onboarding (for testing or settings)
export function resetOnboarding() {
  localStorage.removeItem(STORAGE_KEY);
}

// Helper to check if onboarding is completed
export function isOnboardingCompleted(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}
