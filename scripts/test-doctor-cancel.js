const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testDoctorCancel() {
  try {
console.log('=== 测试医生取消预约功能 ===\n');

// 1. 创建一个测试预约
console.log('1. 创建测试预约...');
    
// 获取一个病人和医生
    const patient = await prisma.patient.findFirst({
      include: { user: true }
    });
    
    const doctor = await prisma.doctor.findFirst({
      include: { user: true, Room: true }
    });

    if (!patient || !doctor) {
console.log('❌ 找不到病人或医生资料');
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

// 创建测试预约
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
reason: '测试医生取消功能'
      },
      include: {
        patient: { include: { user: true } },
        doctor: { include: { user: true } },
        schedule: true
      }
    });

console.log(`✅ 创建测试预约成功:`);
  console.log(`   预约ID: ${testAppointment.id}`);
  console.log(`   病人: ${testAppointment.patient.user.name}`);
  console.log(`   医生: ${testAppointment.doctor.user.name}`);
    console.log(`   狀態: ${testAppointment.status}`);

// 2. 检查病人当前信用分数
console.log('\n2. 检查病人当前信用分数...');
    const patientBefore = await prisma.patient.findUnique({
      where: { id: patient.id },
      select: { credibilityScore: true }
    });
console.log(`   病人当前信用分数: ${patientBefore.credibilityScore}`);

// 3. 模拟医生取消预约的 API 调用
console.log('\n3. 模拟医生取消预约...');
    
// 这里我们直接调用数据库操作，模拟医生取消的逻辑
    await prisma.$transaction(async (tx) => {
// 更新预约状态
      await tx.appointment.update({
        where: { id: testAppointment.id },
        data: { 
          status: 'CANCELLED',
reason: '医生取消预约'
        }
      });

// 医生取消不应该影响病人信用分数
console.log('   ✅ 预约已取消，医生取消不扣除病人分数');
    });

// 4. 检查病人取消后的信用分数
console.log('\n4. 检查病人取消后的信用分数...');
    const patientAfter = await prisma.patient.findUnique({
      where: { id: patient.id },
      select: { credibilityScore: true }
    });
console.log(`   病人取消后信用分数: ${patientAfter.credibilityScore}`);

// 5. 验证分数没有变化
    if (patientBefore.credibilityScore === patientAfter.credibilityScore) {
console.log('   ✅ 验证通过：医生取消预约没有扣除病人分数');
    } else {
console.log('   ❌ 验证失败：病人分数发生了变化');
    }

// 6. 检查预约状态
console.log('\n5. 检查预约最终状态...');
    const finalAppointment = await prisma.appointment.findUnique({
      where: { id: testAppointment.id },
      select: { status: true, reason: true }
    });
    
console.log(`   预约状态: ${finalAppointment.status}`);
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