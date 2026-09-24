import { Card } from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { NotificationList } from '@/components/shared/NotificationList'
import { PushToggle } from '@/components/shared/PushToggle'

export default function Notifications() {
  return (
    <>
      <PageHeader
        title="Notifikasi"
        description="Jatuh tempo, pemesanan DP, perjanjian yang ditandatangani, pesan WhatsApp, dan peristiwa penting lainnya."
      />
      <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
        <Card className="overflow-hidden">
          <NotificationList />
        </Card>
        <Card className="p-5">
          <PushToggle />
        </Card>
      </div>
    </>
  )
}
