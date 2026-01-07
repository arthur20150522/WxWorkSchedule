import React, { useEffect, useState, useRef } from 'react';
import { Card, Typography, Spin, message, QRCode } from 'antd';
import { useNavigate } from 'react-router-dom';
import { getLoginQr, checkLoginStatus } from '../api/auth';

const { Title } = Typography;

const Login: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [qrUrl, setQrUrl] = useState('');
  const [sessionId, setSessionId] = useState('');
  const navigate = useNavigate();
  const timerRef = useRef<any>(null);

  const fetchQrCode = async () => {
    try {
      setLoading(true);
      const res = await getLoginQr();
      setQrUrl(res.qr_code_url);
      setSessionId(res.session_id);
      setLoading(false);
      startPolling(res.session_id);
    } catch (error) {
      message.error('获取登录二维码失败');
      setLoading(false);
    }
  };

  const startPolling = (sid: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      try {
        const res = await checkLoginStatus(sid);
        if (res.status === 'confirmed') {
          clearInterval(timerRef.current);
          message.success('登录成功');
          if (res.access_token) {
            localStorage.setItem('token', res.access_token);
          }
          navigate('/dashboard');
        } else if (res.status === 'expired') {
          clearInterval(timerRef.current);
          message.warning('二维码已过期，请刷新');
        }
      } catch (error) {
        // ignore polling errors
      }
    }, 2000);
  };

  useEffect(() => {
    fetchQrCode();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
      <Card style={{ width: 400, textAlign: 'center' }}>
        <Title level={3}>企业微信扫码登录</Title>
        <div style={{ height: 280, background: '#fff', margin: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {loading ? (
            <Spin size="large" tip="加载二维码..." />
          ) : (
            <>
              <QRCode value={qrUrl || 'error'} size={200} />
              <div style={{ marginTop: 16, color: '#999' }}>
                请使用企业微信扫码登录
                <br />
                (模拟环境：等待几秒自动跳转)
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
};

export default Login;