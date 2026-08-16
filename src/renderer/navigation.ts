'use strict';

/** Small browser-style history for DAW Buddy's single-page interface. */
class NavigationHistory {
  backStack: any[];
  forwardStack: any[];
  limit: number;

  constructor(limit = 50) {
    this.backStack = [];
    this.forwardStack = [];
    this.limit = limit;
  }

  visit(current) {
    this.backStack.push(current);
    if (this.backStack.length > this.limit) this.backStack.shift();
    this.forwardStack = [];
  }

  backFrom(current) {
    if (!this.backStack.length) return null;
    this.forwardStack.push(current);
    return this.backStack.pop();
  }

  forwardFrom(current) {
    if (!this.forwardStack.length) return null;
    this.backStack.push(current);
    return this.forwardStack.pop();
  }
}

export { NavigationHistory };
