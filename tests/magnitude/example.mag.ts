import { test } from 'magnitude-test';

// Learn more about building test case:
// https://docs.magnitude.run/core-concepts/building-test-cases

const sampleTodos = [
    "Take out the trash",
    "Buy groceries",
    "Build more test cases with Magnitude"
];

test('can add and complete todos', { url: 'https://demo.playwright.dev/todomvc' })
    .step('create 3 todos')
        .data(sampleTodos.join(", "))
        .check('should see all 3 todos')
    .step('mark each todo complete')
        .check('says no items left')
