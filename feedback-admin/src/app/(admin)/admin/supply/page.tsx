import { Alert, Card, Col, Row, Tag } from "antd";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";

export const dynamic = "force-dynamic";

const queues = [
  { title: "Замовлення сировини", description: "Заявки цехів і складів на сировину", status: "Очікує міграцію" },
  { title: "Брак сировини", description: "Акти браку, що потребують перевірки", status: "Очікує міграцію" },
  { title: "Прихідні накладні", description: "Накладні та позиції приходу", status: "Очікує міграцію" },
];

export default function SupplyAdminPage() {
  return (
    <AdminPageContainer title="Постачання" subTitle="Заявки з Supply App для цехів і складів">
      <Alert
        type="warning"
        showIcon
        message="Локальний preview: модуль інтерфейсу створено, але Supply migration ще не застосована"
        description="Дані, кнопки погодження та CRM bridge залишаються вимкненими. Система не показує тестові або вигадані документи."
        style={{ marginBottom: 16 }}
      />
      <Row gutter={[16, 16]}>
        {queues.map((queue) => (
          <Col xs={24} md={8} key={queue.title}>
            <Card title={queue.title} extra={<Tag color="gold">{queue.status}</Tag>}>
              <p>{queue.description}</p>
              <p style={{ color: "#6b7280", marginBottom: 0 }}>Після migration тут з’являться фільтри, список, history та захищені вкладення.</p>
            </Card>
          </Col>
        ))}
      </Row>
    </AdminPageContainer>
  );
}
