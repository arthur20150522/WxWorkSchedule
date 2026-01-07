import request from './request';

export interface LoginQRCodeResponse {
  session_id: string;
  qr_code_url: string;
}

export interface LoginStatusResponse {
  status: string;
  access_token?: string;
  user_info?: any;
}

export const getLoginQr = (): Promise<LoginQRCodeResponse> => {
  return request.get('/auth/wechat/login');
};

export const checkLoginStatus = (sessionId: string): Promise<LoginStatusResponse> => {
  return request.get(`/auth/login/status/${sessionId}`);
};