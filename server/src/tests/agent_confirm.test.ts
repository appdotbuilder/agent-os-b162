import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, workspacesTable, agentEventsTable, tasksTable } from '../db/schema';
import { type AgentConfirmInput } from '../schema';
import { agentConfirm } from '../handlers/agent_confirm';
import { eq } from 'drizzle-orm';

describe('agentConfirm', () => {
  beforeEach(createDB);
  afterEach(resetDB);

  it('should reject a proposal when approved is false', async () => {
    // Create test user and workspace
    const user = await db.insert(usersTable)
      .values({
        email: 'test@example.com',
        display_name: 'Test User',
        timezone: 'UTC',
        llm_provider: 'openai',
        llm_model: 'gpt-4'
      })
      .returning()
      .execute();

    const workspace = await db.insert(workspacesTable)
      .values({
        owner_id: user[0].id,
        name: 'Test Workspace',
        settings: {}
      })
      .returning()
      .execute();

    // Create agent event awaiting confirmation
    const agentEvent = await db.insert(agentEventsTable)
      .values({
        workspace_id: workspace[0].id,
        agent: 'task_agent',
        action: 'create_task',
        input: { title: 'Test Task', workspace_id: workspace[0].id },
        status: 'awaiting_confirmation'
      })
      .returning()
      .execute();

    const input: AgentConfirmInput = {
      event_id: agentEvent[0].id,
      approved: false
    };

    const result = await agentConfirm(input);

    // Verify rejection
    expect(result.agent_event.status).toBe('error');
    expect(result.agent_event.output).toEqual({
      rejected: true,
      rejected_at: expect.any(String),
      reason: 'User rejected proposal'
    });
    expect(result.execution_result).toBeUndefined();
  });

  it('should approve and execute task creation', async () => {
    // Create test user and workspace
    const user = await db.insert(usersTable)
      .values({
        email: 'test@example.com',
        display_name: 'Test User',
        timezone: 'UTC',
        llm_provider: 'openai',
        llm_model: 'gpt-4'
      })
      .returning()
      .execute();

    const workspace = await db.insert(workspacesTable)
      .values({
        owner_id: user[0].id,
        name: 'Test Workspace',
        settings: {}
      })
      .returning()
      .execute();

    // Create agent event with task creation action
    const taskInput = {
      workspace_id: workspace[0].id,
      title: 'Agent Created Task',
      description: 'Task created by agent',
      priority: 'high' as const
    };

    const agentEvent = await db.insert(agentEventsTable)
      .values({
        workspace_id: workspace[0].id,
        agent: 'task_agent',
        action: 'create_task',
        input: taskInput,
        status: 'awaiting_confirmation'
      })
      .returning()
      .execute();

    const input: AgentConfirmInput = {
      event_id: agentEvent[0].id,
      approved: true
    };

    const result = await agentConfirm(input);

    // Verify approval and execution
    expect(result.agent_event.status).toBe('executed');
    expect(result.agent_event.output).toEqual({
      approved: true,
      approved_at: expect.any(String),
      executed_action: 'task_created',
      task_id: expect.any(Number)
    });
    expect(result.execution_result).toEqual({
      success: true,
      created_task_id: expect.any(Number),
      message: 'Task created successfully'
    });

    // Verify task was actually created in database
    const createdTasks = await db.select()
      .from(tasksTable)
      .where(eq(tasksTable.workspace_id, workspace[0].id))
      .execute();

    expect(createdTasks).toHaveLength(1);
    expect(createdTasks[0].title).toBe('Agent Created Task');
    expect(createdTasks[0].description).toBe('Task created by agent');
    expect(createdTasks[0].priority).toBe('high');
    expect(createdTasks[0].status).toBe('todo');
  });

  it('should approve and execute non-task actions generically', async () => {
    // Create test user and workspace
    const user = await db.insert(usersTable)
      .values({
        email: 'test@example.com',
        display_name: 'Test User',
        timezone: 'UTC',
        llm_provider: 'openai',
        llm_model: 'gpt-4'
      })
      .returning()
      .execute();

    const workspace = await db.insert(workspacesTable)
      .values({
        owner_id: user[0].id,
        name: 'Test Workspace',
        settings: {}
      })
      .returning()
      .execute();

    // Create agent event with non-task action
    const agentEvent = await db.insert(agentEventsTable)
      .values({
        workspace_id: workspace[0].id,
        agent: 'calendar_agent',
        action: 'schedule_meeting',
        input: { title: 'Team Meeting', duration: 60 },
        status: 'awaiting_confirmation'
      })
      .returning()
      .execute();

    const input: AgentConfirmInput = {
      event_id: agentEvent[0].id,
      approved: true
    };

    const result = await agentConfirm(input);

    // Verify generic execution
    expect(result.agent_event.status).toBe('executed');
    expect(result.agent_event.output).toEqual({
      approved: true,
      approved_at: expect.any(String),
      executed_action: 'schedule_meeting'
    });
    expect(result.execution_result).toEqual({
      success: true,
      message: 'Action schedule_meeting executed successfully'
    });
  });

  it('should throw error for non-existent agent event', async () => {
    const input: AgentConfirmInput = {
      event_id: 99999,
      approved: true
    };

    await expect(agentConfirm(input)).rejects.toThrow(/Agent event with id 99999 not found/i);
  });

  it('should throw error for agent event not awaiting confirmation', async () => {
    // Create test user and workspace
    const user = await db.insert(usersTable)
      .values({
        email: 'test@example.com',
        display_name: 'Test User',
        timezone: 'UTC',
        llm_provider: 'openai',
        llm_model: 'gpt-4'
      })
      .returning()
      .execute();

    const workspace = await db.insert(workspacesTable)
      .values({
        owner_id: user[0].id,
        name: 'Test Workspace',
        settings: {}
      })
      .returning()
      .execute();

    // Create agent event with 'executed' status
    const agentEvent = await db.insert(agentEventsTable)
      .values({
        workspace_id: workspace[0].id,
        agent: 'task_agent',
        action: 'create_task',
        input: { title: 'Test Task' },
        status: 'executed'
      })
      .returning()
      .execute();

    const input: AgentConfirmInput = {
      event_id: agentEvent[0].id,
      approved: true
    };

    await expect(agentConfirm(input)).rejects.toThrow(/not awaiting confirmation.*executed/i);
  });

  it('should handle task creation failure gracefully', async () => {
    // Create test user and workspace
    const user = await db.insert(usersTable)
      .values({
        email: 'test@example.com',
        display_name: 'Test User',
        timezone: 'UTC',
        llm_provider: 'openai',
        llm_model: 'gpt-4'
      })
      .returning()
      .execute();

    const workspace = await db.insert(workspacesTable)
      .values({
        owner_id: user[0].id,
        name: 'Test Workspace',
        settings: {}
      })
      .returning()
      .execute();

    // Create agent event with invalid task input (missing workspace_id)
    const invalidTaskInput = {
      title: 'Invalid Task',
      workspace_id: 99999 // Non-existent workspace
    };

    const agentEvent = await db.insert(agentEventsTable)
      .values({
        workspace_id: workspace[0].id,
        agent: 'task_agent',
        action: 'create_task',
        input: invalidTaskInput,
        status: 'awaiting_confirmation'
      })
      .returning()
      .execute();

    const input: AgentConfirmInput = {
      event_id: agentEvent[0].id,
      approved: true
    };

    const result = await agentConfirm(input);

    // Verify error handling
    expect(result.agent_event.status).toBe('error');
    expect(result.agent_event.output).toEqual({
      approved: true,
      approved_at: expect.any(String),
      execution_error: expect.any(String)
    });
    expect(result.execution_result).toEqual({
      success: false,
      error: expect.any(String)
    });
  });
});