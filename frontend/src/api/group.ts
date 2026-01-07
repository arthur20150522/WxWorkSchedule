import request from './request';

export interface Group {
  id: string;
  name: string;
  chat_id: string;
  member_count: number;
  created_at: string;
}

export const getGroups = (params?: any): Promise<Group[]> => {
  return request.get('/groups/list', { params });
};

export const syncGroups = (): Promise<any> => {
  return request.post('/groups/sync');
};