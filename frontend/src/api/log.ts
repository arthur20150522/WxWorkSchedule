import request from './request';

export interface Log {
  id: string;
  action_type: string;
  status: string;
  message_content: string;
  error_detail: string;
  created_at: string;
}

export const getLogs = (params?: any): Promise<Log[]> => {
  return request.get('/logs/', { params });
};