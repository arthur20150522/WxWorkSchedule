import request from './request';

export interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  variables: string[];
  created_at: string;
}

export interface SendMessageParams {
  group_ids: string[];
  content: string;
  message_type?: string;
}

export interface CreateTemplateParams {
  name: string;
  content: string;
  variables: string[];
}

export const getTemplates = (): Promise<MessageTemplate[]> => {
  return request.get('/messages/templates');
};

export const createTemplate = (data: CreateTemplateParams): Promise<MessageTemplate> => {
  return request.post('/messages/templates', data);
};

export const sendMessage = (data: SendMessageParams): Promise<any> => {
  return request.post('/messages/send', data);
};