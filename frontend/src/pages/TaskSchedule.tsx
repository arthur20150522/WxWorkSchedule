import React, { useState, useEffect } from 'react';
import { Form, Input, DatePicker, Select, Button, message, Card } from 'antd';
import { createTask } from '../api/task';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import { getGroups } from '../api/group';

const { Option } = Select;
const { TextArea } = Input;

const TaskSchedule: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [groups, setGroups] = useState<any[]>([]);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const res = await getGroups();
      setGroups(res);
    } catch (error) {
      message.error('加载群组失败');
    }
  };

  const onFinish = async (values: any) => {
    try {
      setLoading(true);
      const taskData = {
        ...values,
        schedule_time: values.schedule_time.toISOString(),
      };
      await createTask(taskData);
      message.success('任务创建成功');
      navigate('/tasks/manage');
    } catch (error) {
      message.error('任务创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="创建定时任务" style={{ maxWidth: 800, margin: '0 auto' }}>
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{ repeat_type: 'once' }}
      >
        <Form.Item
          name="name"
          label="任务名称"
          rules={[{ required: true, message: '请输入任务名称' }]}
        >
          <Input placeholder="例如：每日早报推送" />
        </Form.Item>

        <Form.Item
          name="group_ids"
          label="目标群组"
          rules={[{ required: true, message: '请选择至少一个群组' }]}
        >
          <Select mode="multiple" placeholder="请选择群组">
            {groups.map(group => (
              <Option key={group.id} value={group.id}>{group.name}</Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="message_content"
          label="消息内容"
          rules={[{ required: true, message: '请输入消息内容' }]}
        >
          <TextArea rows={6} placeholder="支持文本内容..." />
        </Form.Item>

        <Form.Item
          name="schedule_time"
          label="执行时间"
          rules={[{ required: true, message: '请选择执行时间' }]}
        >
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="repeat_type"
          label="重复类型"
          rules={[{ required: true, message: '请选择重复类型' }]}
        >
          <Select>
            <Option value="once">仅一次</Option>
            <Option value="daily">每天</Option>
            <Option value="weekly">每周</Option>
            <Option value="monthly">每月</Option>
          </Select>
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>
            创建任务
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
};

export default TaskSchedule;