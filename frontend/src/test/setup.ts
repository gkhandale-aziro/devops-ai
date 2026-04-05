import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView — stub it globally
window.HTMLElement.prototype.scrollIntoView = () => {};
