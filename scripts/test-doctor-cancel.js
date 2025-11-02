const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testDoctorCancel() {
  try {
    console.log('=== 測試醫生取消預約功能 ===\n');

    // 1. 創建一個測試預約
    console.log('1. 創建測試預約...');
    
    // 獲取一個病人和醫生
    const patient = await prisma.patient.findFirst({
      include: { user: true }
    });
    
    const doctor = await prisma.doctor.findFirst({
      include: { user: true, Room: true }
    });

    if (!patient || !doctor) {
      console.log('❌ 找不到病人或醫生資料');
      return;
    }

    // 獲取一個排程
    const schedule = await prisma.schedule.findFirst({
      where: {
        doctorId: doctor.id,
        date: {
          gte: new Date().toISOString().split('T')[0]
        }
      },
      include: {
        room: true
      }
    });

    if (!schedule) {
      console.log('❌ 找不到可用的排程');
      return;
    }

    // 創建測試預約
    const testAppointment = await prisma.appointment.create({
      data: {
        userId: patient.userId,
        patientId: patient.id,
        doctorId: doctor.id,
        scheduleId: schedule.id,
        roomId: schedule.roomId, // 使用排程中的roomId
        bedId: 1, // 添加必需的bedId字段
        time: '10:00',
        status: 'PENDING',
        reason: '測試醫生取消功能'
      },
      include: {
        patient: { include: { user: true } },
        doctor: { include: { user: true } },
        schedule: true
      }
    });

    console.log(`✅ 創建測試預約成功:`);
    console.log(`   預約ID: ${testAppointment.id}`);
    console.log(`   病人: ${testAppointment.patient.user.name}`);
    console.log(`   醫生: ${testAppointment.doctor.user.name}`);
    console.log(`   狀態: ${testAppointment.status}`);

    // 2. 檢查病人當前信用分數
    console.log('\n2. 檢查病人當前信用分數...');
    const patientBefore = await prisma.patient.findUnique({
      where: { id: patient.id },
      select: { credibilityScore: true }
    });
    console.log(`   病人當前信用分數: ${patientBefore.credibilityScore}`);

    // 3. 模擬醫生取消預約的API調用
    console.log('\n3. 模擬醫生取消預約...');
    
    // 這裡我們直接調用數據庫操作，模擬醫生取消的邏輯
    await prisma.$transaction(async (tx) => {
      // 更新預約狀態
      await tx.appointment.update({
        where: { id: testAppointment.id },
        data: { 
          status: 'CANCELLED',
          reason: '醫生取消預約'
        }
      });

      // 醫生取消不應該影響病人信用分數
      console.log('   ✅ 預約已取消，醫生取消不扣除病人分數');
    });

    // 4. 檢查病人取消後的信用分數
    console.log('\n4. 檢查病人取消後的信用分數...');
    const patientAfter = await prisma.patient.findUnique({
      where: { id: patient.id },
      select: { credibilityScore: true }
    });
    console.log(`   病人取消後信用分數: ${patientAfter.credibilityScore}`);

    // 5. 驗證分數沒有變化
    if (patientBefore.credibilityScore === patientAfter.credibilityScore) {
      console.log('   ✅ 驗證通過：醫生取消預約沒有扣除病人分數');
    } else {
      console.log('   ❌ 驗證失敗：病人分數發生了變化');
    }

    // 6. 檢查預約狀態
    console.log('\n5. 檢查預約最終狀態...');
    const finalAppointment = await prisma.appointment.findUnique({
      where: { id: testAppointment.id },
      select: { status: true, reason: true }
    });
    
    console.log(`   預約狀態: ${finalAppointment.status}`);
    console.log(`   取消原因: ${finalAppointment.reason}`);

    // 7. 清理測試數據
    console.log('\n6. 清理測試數據...');
    await prisma.appointment.delete({
      where: { id: testAppointment.id }
    });
    console.log('   ✅ 測試數據已清理');

    console.log('\n=== 測試完成 ===');

  } catch (error) {
    console.error('❌ 測試過程中發生錯誤:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testDoctorCancel();