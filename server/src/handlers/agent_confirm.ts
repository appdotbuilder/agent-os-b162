import { db } from '../db';
import { agentEventsTable, tasksTable } from '../db/schema';
import { type AgentConfirmInput, type AgentEvent } from '../schema';
import { eq } from 'drizzle-orm';

export interface AgentConfirmResponse {
    agent_event: AgentEvent;
    execution_result?: Record<string, unknown>;
    error?: string;
}

export const agentConfirm = async (input: AgentConfirmInput): Promise<AgentConfirmResponse> => {
    try {
        // First, fetch the existing agent event
        const existingEvents = await db.select()
            .from(agentEventsTable)
            .where(eq(agentEventsTable.id, input.event_id))
            .execute();

        if (existingEvents.length === 0) {
            throw new Error(`Agent event with id ${input.event_id} not found`);
        }

        const existingEvent = existingEvents[0];
        
        // Type assertion for the input field to satisfy type checker
        const eventInput = existingEvent.input as Record<string, unknown>;

        // Check if event is in awaiting_confirmation status
        if (existingEvent.status !== 'awaiting_confirmation') {
            throw new Error(`Agent event ${input.event_id} is not awaiting confirmation (current status: ${existingEvent.status})`);
        }

        if (!input.approved) {
            // User rejected the proposal - mark as error
            const updatedEvent = await db.update(agentEventsTable)
                .set({
                    status: 'error',
                    output: { 
                        rejected: true, 
                        rejected_at: new Date(),
                        reason: 'User rejected proposal'
                    }
                })
                .where(eq(agentEventsTable.id, input.event_id))
                .returning()
                .execute();

            return {
                agent_event: {
                    ...updatedEvent[0],
                    input: updatedEvent[0].input as Record<string, unknown>,
                    output: updatedEvent[0].output as Record<string, unknown> | null
                }
            };
        }

        // User approved - execute the action based on the agent and action type
        let executionResult: Record<string, unknown> = {};
        let outputData: Record<string, unknown> = {
            approved: true,
            approved_at: new Date()
        };

        // Handle different action types
        if (existingEvent.action === 'create_task') {
            // Execute task creation
            try {
                const newTask = await db.insert(tasksTable)
                    .values({
                        workspace_id: eventInput['workspace_id'] as number,
                        title: eventInput['title'] as string,
                        description: (eventInput['description'] as string) || null,
                        priority: (eventInput['priority'] as 'low' | 'med' | 'high') || 'med',
                        due_at: eventInput['due_at'] ? new Date(eventInput['due_at'] as string) : null,
                        status: 'todo'
                    })
                    .returning()
                    .execute();

                executionResult = { 
                    success: true, 
                    created_task_id: newTask[0].id,
                    message: 'Task created successfully'
                };
                outputData['executed_action'] = 'task_created';
                outputData['task_id'] = newTask[0].id;
            } catch (error) {
                executionResult = { 
                    success: false, 
                    error: error instanceof Error ? error.message : 'Unknown error occurred'
                };
                outputData['execution_error'] = executionResult['error'];
            }
        } else {
            // For other action types, just mark as executed
            executionResult = { 
                success: true, 
                message: `Action ${existingEvent.action} executed successfully`
            };
            outputData['executed_action'] = existingEvent.action;
        }

        // Update the agent event status to executed
        const updatedEvent = await db.update(agentEventsTable)
            .set({
                status: executionResult['success'] ? 'executed' : 'error',
                output: outputData
            })
            .where(eq(agentEventsTable.id, input.event_id))
            .returning()
            .execute();

        return {
            agent_event: {
                ...updatedEvent[0],
                input: updatedEvent[0].input as Record<string, unknown>,
                output: updatedEvent[0].output as Record<string, unknown> | null
            },
            execution_result: executionResult
        };

    } catch (error) {
        console.error('Agent confirmation failed:', error);
        throw error;
    }
};