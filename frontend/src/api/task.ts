import request from './request';

export interface Task {
  id: string;
  name: string;
  message_content: string;
  schedule_time: string;
  repeat_type: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
  repeat_config?: any;
  status: 'active' | 'inactive' | 'completed' | 'failed';
  group_ids: string[];
  next_execution_time?: string;
  execution_count: number;
  success_count: number;
  failure_count: number;
  created_at: string;
}

export interface CreateTaskParams {
  name: string;
  message_content: string;
  schedule_time: string;
  repeat_type: string;
  repeat_config?: any;
  group_ids: string[];
}

export const getTasks = (params?: any): Promise<Task[]> => {
  return request.get('/tasks/list', { params });
};

export const createTask = (data: CreateTaskParams): Promise<Task> => {
  return request.post('/tasks/schedule', data);
};

export const updateTaskStatus = (taskId: string, status: string): Promise<any> => {
  return request.put(`/tasks/${taskId}/status`, null, { params: { status } });
};

export const deleteTask = (taskId: string): Promise<any> => {
  return request.delete(`/tasks/${taskId}`);
};