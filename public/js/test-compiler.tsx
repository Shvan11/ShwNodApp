/**
 * Test Component to Verify React Compiler Automatic Optimization
 *
 * This component should be automatically memoized by React Compiler.
 * Without the compiler, every parent re-render would re-render this child.
 * With the compiler, it should only re-render when props change.
 */
import { useState } from 'react';

interface ExpensiveChildProps {
    name: string;
    count: number;
}

// Child component - should be automatically memoized by React Compiler
function ExpensiveChild({ name, count }: ExpensiveChildProps) {
    console.log('🔄 ExpensiveChild RENDERED with:', { name, count });

    // Expensive calculation that should be auto-memoized
    const expensiveResult = (() => {
        let result = 0;
        for (let i = 0; i < 1000000; i++) {
            result += i;
        }
        return result + count;
    })();

    return (
        <div style={{ padding: '1rem', border: '2px solid green', margin: '1rem 0' }}>
            <h3>Child Component (Should NOT re-render when parent state changes)</h3>
            <p>Name: {name}</p>
            <p>Count: {count}</p>
            <p>Expensive Result: {expensiveResult}</p>
        </div>
    );
}

// Parent component to test
export default function CompilerTest() {
    const [parentCounter, setParentCounter] = useState(0);
    const [childName] = useState('John');
    const [childCount, setChildCount] = useState(0);

    console.log('🔄 Parent RENDERED with parentCounter:', parentCounter);

    return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
            <h1>React Compiler Test</h1>

            <div style={{ padding: '1rem', border: '2px solid blue', marginBottom: '1rem' }}>
                <h2>Parent Component</h2>
                <p>Parent Counter: {parentCounter}</p>

                <button
                    onClick={() => setParentCounter(c => c + 1)}
                    style={{ padding: '0.5rem 1rem', marginRight: '0.5rem', cursor: 'pointer' }}
                >
                    Increment Parent Counter (Should NOT re-render child)
                </button>

                <button
                    onClick={() => setChildCount(c => c + 1)}
                    style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
                >
                    Increment Child Count (SHOULD re-render child)
                </button>
            </div>

            <ExpensiveChild name={childName} count={childCount} />

            <div style={{ marginTop: '2rem', padding: '1rem', background: '#f0f0f0', borderRadius: '8px' }}>
                <h3>✅ Test Instructions:</h3>
                <ol>
                    <li>Open browser console (F12)</li>
                    <li>Click "Increment Parent Counter" - You should see ONLY parent log, NO child log</li>
                    <li>Click "Increment Child Count" - You should see BOTH parent and child logs</li>
                </ol>
                <p><strong>If child re-renders when parent counter increments = Compiler NOT working</strong></p>
                <p><strong>If child only re-renders when its own props change = Compiler IS working ✅</strong></p>
            </div>
        </div>
    );
}
