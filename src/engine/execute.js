var Thread = require('./thread');

/**
 * If set, block calls, args, and return values will be logged to the console.
 * @const {boolean}
 */
var DEBUG_BLOCK_CALLS = true;

/**
 * Execute a block.
 * @param {!Sequencer} sequencer Which sequencer is executing.
 * @param {!Thread} thread Thread which to read and execute.
 * @param {string=} opt_waitingInputName If evaluating an input, its name.
 * @return {?Any} Reported value, if available immediately.
 */
var execute = function (sequencer, thread, opt_waitingInputName) {
    var runtime = sequencer.runtime;

    // Current block to execute is the one on the top of the stack.
    var currentBlockId = thread.peekStack();
    var currentStackFrame = thread.peekStackFrame();

    var opcode = runtime.blocks.getOpcode(currentBlockId);

    // Generate values for arguments (inputs).
    var argValues = {};

    // Add all fields on this block to the argValues.
    var fields = runtime.blocks.getFields(currentBlockId);
    for (var fieldName in fields) {
        argValues[fieldName] = fields[fieldName].value;
    }

    // Recursively evaluate input blocks.
    var inputs = runtime.blocks.getInputs(currentBlockId);
    for (var inputName in inputs) {
        var input = inputs[inputName];
        var inputBlockId = input.block;
        // Is there a value for this input waiting in the stack frame?
        if (currentStackFrame.reported &&
            currentStackFrame.reported[inputName]) {
            // Use that value.
            argValues[inputName] = currentStackFrame.reported[inputName];
        } else {
            // Otherwise, we need to evaluate the block.
            // Push to the stack to evaluate this input.
            thread.pushStack(inputBlockId);
            if (DEBUG_BLOCK_CALLS) {
                console.time('Yielding reporter evaluation');
            }
            var result = execute(sequencer, thread, inputName);
            // Did the reporter yield?
            if (thread.status === Thread.STATUS_YIELD) {
                // Reporter yielded; don't pop stack and wait for it to unyield.
                // The value will be populated once the reporter unyields,
                // and passed up to the currentStackFrame on next execution.
                return;
            }
            thread.popStack();
            argValues[inputName] = result;
        }
    }

    if (!opcode) {
        console.warn('Could not get opcode for block: ' + currentBlockId);
        return;
    }

    var blockFunction = runtime.getOpcodeFunction(opcode);
    if (!blockFunction) {
        console.warn('Could not get implementation for opcode: ' + opcode);
        return;
    }

    if (DEBUG_BLOCK_CALLS) {
        console.groupCollapsed('Executing: ' + opcode);
        console.log('with arguments: ', argValues);
        console.log('and stack frame: ', currentStackFrame);
    }
    var primitiveReturnValue = null;
    primitiveReturnValue = blockFunction(argValues, {
        yield: thread.yield.bind(thread),
        done: function() {
            sequencer.proceedThread(thread);
        },
        report: function(reportedValue) {
            thread.pushReportedValue(opt_waitingInputName, reportedValue);
            if (DEBUG_BLOCK_CALLS) {
                console.log('Reported: ', reportedValue,
                    ' for ', opt_waitingInputName);
                console.timeEnd('Yielding reporter evaluation');
            }
            sequencer.proceedThread(thread);
        },
        timeout: thread.addTimeout.bind(thread),
        stackFrame: currentStackFrame.executionContext,
        startSubstack: function (substackNum) {
            sequencer.stepToSubstack(thread, substackNum);
        }
    });
    if (DEBUG_BLOCK_CALLS) {
        console.log('ending stack frame: ', currentStackFrame);
        console.log('returned immediately: ', primitiveReturnValue);
        console.groupEnd();
    }
    return primitiveReturnValue;
};

module.exports = execute;
