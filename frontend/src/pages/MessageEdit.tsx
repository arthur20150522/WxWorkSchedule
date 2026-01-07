import React, { useState, useEffect } from 'react';
import { Form, Input, Select, Button, message, Card, List, Modal, Tabs, Row, Col } from 'antd';
import { SendOutlined, SaveOutlined, FileTextOutlined } from '@ant-design/icons';
import { getGroups } from '../api/group';
import { getTemplates, createTemplate, sendMessage, MessageTemplate } from '../api/message';

const { Option } = Select;
const { TextArea } = Input;
const { TabPane } = Tabs;

const MessageEdit: React.FC = () => {
  const [form] = Form.useForm();
  const [groups, setGroups] = useState<any[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    fetchGroups();
    fetchTemplates();
  }, []);

  const fetchGroups = async () => {
    try {
      const res = await getGroups();
      setGroups(res);
    } catch (error) {
      // ignore
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await getTemplates();
      setTemplates(res);
    } catch (error) {
      // ignore
    }
  };

  const handleSend = async (values: any) => {
    try {
      setLoading(true);
      await sendMessage({
        group_ids: values.group_ids,
        content: values.content,
        message_type: 'text'
      });
      message.success('消息已发送');
      form.resetFields();
    } catch (error) {
      message.error('发送失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTemplate = () => {
    const content = form.getFieldValue('content');
    if (!content) {
      message.warning('请先输入消息内容');
      return;
    }
    setIsModalVisible(true);
  };

  const confirmSaveTemplate = async () => {
    if (!templateName) {
      message.warning('请输入模板名称');
      return;
    }
    try {
      const content = form.getFieldValue('content');
      await createTemplate({
        name: templateName,
        content: content,
        variables: [] // Extract variables logic if needed
      });
      message.success('模板保存成功');
      setIsModalVisible(false);
      setTemplateName('');
      fetchTemplates();
    } catch (error) {
      message.error('保存失败');
    }
  };

  const applyTemplate = (tpl: MessageTemplate) => {
    form.setFieldsValue({ content: tpl.content });
    message.info(`已应用模板：${tpl.name}`);
  };

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <div style={{ flex: 1 }}>
        <Card title="消息编辑与发送">
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSend}
          >
            <Form.Item
              name="group_ids"
              label="选择发送群组"
              rules={[{ required: true, message: '请选择群组' }]}
            >
              <Select mode="multiple" placeholder="请选择群组" allowClear>
                {groups.map(g => (
                  <Option key={g.id} value={g.id}>{g.name}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="content"
              label="消息内容"
              rules={[{ required: true, message: '请输入内容' }]}
            >
              <TextArea 
                rows={10} 
                placeholder="在此输入消息内容... 支持 {variable} 格式的变量" 
                showCount 
                maxLength={2000} 
              />
            </Form.Item>

            <Form.Item>
              <div style={{ display: 'flex', gap: 16 }}>
                <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={loading}>
                  立即发送
                </Button>
                <Button icon={<SaveOutlined />} onClick={handleSaveTemplate}>
                  存为模板
                </Button>
              </div>
            </Form.Item>
          </Form>
        </Card>
      </div>

      <div style={{ width: 300 }}>
        <Card title="消息模板" bodyStyle={{ padding: 0 }}>
          <List
            dataSource={templates}
            renderItem={item => (
              <List.Item 
                actions={[<Button type="link" size="small" onClick={() => applyTemplate(item)}>应用</Button>]}
                style={{ padding: '12px 24px' }}
              >
                <List.Item.Meta
                  avatar={<FileTextOutlined />}
                  title={item.name}
                  description={<div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>{item.content}</div>}
                />
              </List.Item>
            )}
            style={{ maxHeight: 600, overflowY: 'auto' }}
          />
        </Card>
      </div>

      <Modal
        title="保存模板"
        open={isModalVisible}
        onOk={confirmSaveTemplate}
        onCancel={() => setIsModalVisible(false)}
      >
        <Input 
          placeholder="请输入模板名称" 
          value={templateName} 
          onChange={e => setTemplateName(e.target.value)} 
        />
      </Modal>
    </div>
  );
};

export default MessageEdit;